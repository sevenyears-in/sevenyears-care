// Day-wise sales history per store (server only), from the bills and returns copied from Zoho.
// Net = billed (with GST) − returns. Daily target = the store's monthly target ÷ days in that month.

import { savedDaily } from "@/lib/reconcile";
import { loadTargets } from "@/lib/performance";
import { loadPerformanceSettings } from "@/lib/performance-settings";
import { dayState, type DayState } from "@/lib/business-day";

export type DailyRow = {
  date: string;
  store: string;
  bills: number;
  billed: number;
  returned: number;
  returns: number;
  net: number;
  target: number;
  achievement: number | null;
  variance: number;
  prevNet: number | null;
  change: number | null;
  state: DayState;
};

const daysIn = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
};
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Rows newest first. `stores` limits to the stores the person may see; "ALL" adds a consolidated row a day. */
export async function dailySales(from: string, to: string, stores: string[], consolidated: boolean) {
  const settings = await loadPerformanceSettings();
  // One day earlier, for "vs previous day".
  const raw = (await savedDaily(addDays(from, -1), to)).filter((r) => stores.includes(r.store));
  const months = [...new Set(raw.map((r) => r.date.slice(0, 7)))];
  const targets = new Map<string, Map<string, number>>();
  for (const m of months) targets.set(m, (await loadTargets(m)).stores);
  const monthTarget = (store: string, m: string) => targets.get(m)?.get(store) ?? settings.storeTargets[store] ?? 0;

  // Fill missing days (no bills) so the trend shows them.
  const byKey = new Map(raw.map((r) => [`${r.date}|${r.store}`, r]));
  const rows: DailyRow[] = [];
  const list = (consolidated ? ["ALL"] : stores).slice();
  for (const store of list) {
    let prev: number | null = null;
    for (let d = addDays(from, -1); d <= to; d = addDays(d, 1)) {
      const keys = store === "ALL" ? stores : [store];
      const parts = keys.map((s) => byKey.get(`${d}|${s}`)).filter((r): r is NonNullable<typeof r> => Boolean(r));
      const sum = (k: "bills" | "billed" | "returned" | "returns" | "net") => parts.reduce((a, r) => a + r[k], 0);
      const m = d.slice(0, 7);
      const target = (store === "ALL" ? stores.reduce((a, s) => a + monthTarget(s, m), 0) : monthTarget(store, m)) / daysIn(m);
      const net = sum("net");
      const states = (store === "ALL" ? stores : [store]).map((s) => dayState(settings, s, d, settings.lastSyncAt ?? null));
      const state: DayState = states.includes("live") ? "live" : states.includes("provisional") ? "provisional" : states.every((x) => x === "special") ? "special" : "closed";
      if (d >= from) {
        rows.push({
          date: d,
          store,
          bills: sum("bills"),
          billed: Math.round(sum("billed")),
          returned: Math.round(sum("returned")),
          returns: sum("returns"),
          net: Math.round(net),
          target: Math.round(target),
          achievement: target > 0 ? net / target : null,
          variance: Math.round(net - target),
          prevNet: prev,
          change: prev && prev > 0 ? net / prev - 1 : null,
          state,
        });
      }
      prev = Math.round(net);
    }
  }
  return rows.sort((a, b) => (a.date === b.date ? a.store.localeCompare(b.store) : b.date.localeCompare(a.date)));
}
