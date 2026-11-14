// Day-wise sales history per store (server only), from the bills and returns copied from Zoho.
// Net = billed (with GST) − returns. Daily target = the store's monthly target ÷ days in that month.

import { savedDaily } from "@/lib/reconcile";
import { loadTargets } from "@/lib/performance";
import { loadPerformanceSettings } from "@/lib/performance-settings";
import { dayState, type DayState } from "@/lib/business-day";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Uploaded sales (Excel) per store and day, for days with no bills copied from Zoho. */
async function uploadedDaily(from: string, to: string, stores: string[]) {
  const out = new Map<string, number>();
  if (!stores.length) return out;
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabaseAdmin
      .from("sales_history_lines")
      .select("store, day, net")
      .in("store", stores)
      .gte("day", from)
      .lte("day", to)
      .range(page * 1000, page * 1000 + 999);
    if (error || !data?.length) break;
    for (const r of data) {
      const k = `${r.day}|${r.store}`;
      out.set(k, (out.get(k) ?? 0) + Number(r.net ?? 0));
    }
    if (data.length < 1000) break;
  }
  return out;
}

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
  /** No bills copied from Zoho and nothing uploaded for this day (yet): left out of totals and averages. */
  noData: boolean;
  /** "All stores" row where some stores have no data that day. */
  partial: boolean;
  /** Figures come from an Excel upload (no bills copied for that day). */
  fromUpload: boolean;
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
  const uploaded = await uploadedDaily(addDays(from, -1), to, stores).catch(() => new Map<string, number>());
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
      const parts = keys.map((s) => byKey.get(`${d}|${s}`)).filter((r): r is NonNullable<typeof r> => Boolean(r) && (r!.bills > 0 || r!.returns > 0));
      const sum = (k: "bills" | "billed" | "returned" | "returns" | "net") => parts.reduce((a, r) => a + r[k], 0);
      // Stores with no bills that day: use an Excel upload when there is one, otherwise "no data yet".
      const withBills = new Set(parts.map((r) => r.store));
      const missing = keys.filter((s) => !withBills.has(s));
      const upNet = missing.reduce((a, s) => a + (uploaded.get(`${d}|${s}`) ?? 0), 0);
      const upStores = missing.filter((s) => uploaded.has(`${d}|${s}`));
      const stillMissing = missing.filter((s) => !uploaded.has(`${d}|${s}`));
      const m = d.slice(0, 7);
      const target = (store === "ALL" ? stores.reduce((a, s) => a + monthTarget(s, m), 0) : monthTarget(store, m)) / daysIn(m);
      const net = sum("net") + upNet;
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
          noData: state !== "live" && state !== "special" && stillMissing.length === keys.length,
          partial: state !== "live" && stillMissing.length > 0 && stillMissing.length < keys.length,
          fromUpload: upStores.length > 0,
        });
      }
      prev = stillMissing.length === keys.length ? null : Math.round(net);
    }
  }
  return rows.sort((a, b) => (a.date === b.date ? a.store.localeCompare(b.store) : b.date.localeCompare(a.date)));
}
