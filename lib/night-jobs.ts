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

export function startNightJobs() {
  if (g.__syNightJobs) return;
  g.__syNightJobs = true;
  const tick = () => {
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
