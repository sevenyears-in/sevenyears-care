// Background timer started once when the server starts (instrumentation.ts). Server only.
// Every minute between 11:30 and 11:59 pm (India time):
//   1. reads stock per store from Zoho POS (once a night), then
//   2. copies earlier months (lib/sales-backfill.ts).
// Each job makes sure it runs once at a time and stays inside the Zoho request limits.

import { inNightWindow, loadBackfill, runNightBackfill } from "@/lib/sales-backfill";
import { isStockReading, loadStockState, readStockFromZoho } from "@/lib/stock";
import { zohoCallsToday } from "@/lib/zoho";
import { todayISO } from "@/lib/helpers";

const g = globalThis as unknown as { __syNightJobs?: boolean; __syNightBusy?: boolean };

/** One check (safe to call often). */
export async function nightTick(): Promise<string> {
  if (!inNightWindow()) return "outside 11:30–11:59 pm";
  if (g.__syNightBusy || isStockReading()) return "already running";
  g.__syNightBusy = true;
  try {
    const stock = await loadStockState();
    let stockNote = "";
    if (!stock.lastAt || todayISO(new Date(stock.lastAt)) !== todayISO()) {
      const settings = await loadBackfill();
      const room = settings.dailyQuota - (await zohoCallsToday()) - 250;
      if (room > 50) stockNote = `stock: ${await readStockFromZoho(Math.min(1200, Math.floor(room / 2)))}; `;
    }
    return stockNote + `earlier months: ${await runNightBackfill()}`;
  } finally {
    g.__syNightBusy = false;
  }
}

/** Daytime jobs every minute: sales update alerts (at the alert times) and end-of-day reports (after closing). */
async function dayTick() {
  const { alertTick } = await import("@/lib/sales-alerts");
  const { eodTick } = await import("@/lib/eod-report");
  const a = await alertTick().catch((e) => `alerts error: ${e instanceof Error ? e.message : e}`);
  if (!/alerts off|no slot due|already/.test(a)) console.log("Sales alerts:", a);
  const { stockAlertTick } = await import("@/lib/stock-alerts");
  const st = await stockAlertTick().catch((e) => `stock alert error: ${e instanceof Error ? e.message : e}`);
  if (!/off|no slot due|already/.test(st)) console.log("Stock alert:", st);
  const { openCloseTick } = await import("@/lib/store-open-close");
  const oc = await openCloseTick().catch((e) => `open/close error: ${e instanceof Error ? e.message : e}`);
  if (!/nothing due|already running|no store devices/.test(oc)) console.log("Store open/close:", oc);
  // CCTV photos: keep the ones at opening / closing punches, delete the rest after a few days (hourly).
  const { cctvCleanupTick } = await import("@/lib/cctv");
  const { punchMoments } = await import("@/lib/store-open-close");
  const cam = await cctvCleanupTick(async (store, day) => {
    const m = (await punchMoments(store, [day])).get(day);
    return [m?.open, m?.close].filter((x): x is number => typeof x === "number");
  }).catch((e) => `cctv clean-up error: ${e instanceof Error ? e.message : e}`);
  if (cam) console.log(cam);
  // AI photo check of the doorway photos, and the daily e-mail about the people to watch.
  const ai = await import("@/lib/camera-ai");
  const aiRes = await ai.cameraAiTick().catch((e) => `camera AI error: ${e instanceof Error ? e.message : e}`);
  if (aiRes) console.log("Camera AI:", aiRes);
  const rep = await ai.watchReportTick().catch((e) => `watch report error: ${e instanceof Error ? e.message : e}`);
  if (rep) console.log("Watch report:", rep);
  // Automatic reminders / warnings / PIP (once a day, after 11 am).
  const { disciplineTick } = await import("@/lib/discipline");
  const dis = await disciplineTick().catch((e) => `automatic letters error: ${e instanceof Error ? e.message : e}`);
  if (!/^(not yet|already)$/.test(dis)) console.log("Automatic letters:", dis);
  const { applyDueStores } = await import("@/lib/assignments");
  const moved = await applyDueStores().catch(() => 0);
  if (moved) console.log("Transfers applied:", moved);
  const r = await eodTick().catch((e) => `end-of-day error: ${e instanceof Error ? e.message : e}`);
  if (!/off|nothing due|already running/.test(r)) console.log("End-of-day reports:", r);
}

export function startNightJobs() {
  if (g.__syNightJobs) return;
  g.__syNightJobs = true;
  const tick = () => {
    void dayTick().catch((e) => console.error("Day jobs error:", e));
    if (!inNightWindow()) return;
    nightTick()
      .then((r) => {
        if (!/already running|nothing to copy/.test(r)) console.log("Night jobs:", r);
      })
      .catch((e) => console.error("Night jobs error:", e));
  };
  const timer = setInterval(tick, 60_000);
  timer.unref?.();
}
