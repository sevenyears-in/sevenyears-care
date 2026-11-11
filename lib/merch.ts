// Category and product view for Store Managers, ASM / Floor Managers and management (server only).
//   MoM  = this month's days 1–N against last month's days 1–N.
//   LFL  = the same dates last year, same store.
//   Sell-through = units sold this month ÷ (units sold + stock on hand now).
//   Stock cover  = stock on hand ÷ average units sold a day over the last 28 days.
//   Stock-out    = 0 in the store and sold in the last 60 days.

import { todayISO } from "@/lib/helpers";
import { addDays, daysWithData, fastMovers, itemSales, OVERSTOCK_DAYS, REORDER_DAYS, stockFor, type ItemSales } from "@/lib/stock";
import { isCarryBag } from "@/lib/sales-sync";

export type MerchItem = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  net: number;
  units: number;
  momNet: number | null;
  lflNet: number | null;
  units28: number;
  stock: number | null;
  rate: number | null;
  sellThrough: number | null;
  cover: number | null;
  outSince: string | null;
  fast: boolean;
  status: "out" | "low" | "over" | "ok" | "no_stock_data";
};

export type MerchCategory = {
  name: string;
  net: number;
  units: number;
  momNet: number | null;
  lflNet: number | null;
  stock: number;
  stockValue: number;
  units28: number;
  sellThrough: number | null;
  cover: number | null;
  stockOuts: number;
  lowFast: number;
  overstock: number;
  items: number;
};

export type MerchReport = {
  store: string;
  month: string;
  today: string;
  periods: { mtd: [string, string]; mom: [string, string]; lfl: [string, string] };
  /** Share of the comparison days that have sales data (bills copied or uploaded). */
  momCoverage: number;
  lflCoverage: number;
  stockAt: string | null;
  totals: MerchCategory;
  categories: MerchCategory[];
  items: MerchItem[];
};

const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const daysIn = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
};
const dayOf = (m: string, d: number) => `${m}-${String(Math.min(d, daysIn(m))).padStart(2, "0")}`;

const cache = new Map<string, { at: number; value: MerchReport }>();

export async function merchReport(store: string, month = todayISO().slice(0, 7)): Promise<MerchReport> {
  const today = todayISO();
  const key = `${store}|${month}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;

  // Days 1..N of the month (N = today in the current month, else the whole month).
  const n = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : daysIn(month);
  const mtd: [string, string] = [`${month}-01`, dayOf(month, n)];
  const pm = shiftMonth(month, -1);
  const mom: [string, string] = [`${pm}-01`, dayOf(pm, n)];
  const ly = shiftMonth(month, -12);
  const lfl: [string, string] = [`${ly}-01`, dayOf(ly, n)];
  const end = mtd[1];

  const [now, before, lastYear, s28, s60, stock, momDays, lflDays, days28] = await Promise.all([
    itemSales(store, ...mtd),
    itemSales(store, ...mom),
    itemSales(store, ...lfl),
    itemSales(store, addDays(end, -27), end),
    itemSales(store, addDays(end, -59), end),
    stockFor(store),
    daysWithData(store, ...mom),
    daysWithData(store, ...lfl),
    daysWithData(store, addDays(end, -27), end),
  ]);
  // Average a day over the days that have sales data (earlier months may not be copied yet).
  const window28 = Math.max(1, Math.min(28, days28));
  const momCoverage = momDays / Math.max(1, Number(mom[1].slice(8, 10)));
  const lflCoverage = lflDays / Math.max(1, Number(lfl[1].slice(8, 10)));
  const momOk = momCoverage >= 0.8;
  const lflOk = lflCoverage >= 0.8;
  const fast = fastMovers(s28);

  const stockById = new Map(stock.filter((r) => !isCarryBag(r.category)).map((r) => [r.item_id, r]));
  const ids = new Set<string>([...now.keys(), ...s60.keys(), ...stockById.keys()]);
  const items: MerchItem[] = [];
  for (const id of ids) {
    const a = now.get(id);
    const st = stockById.get(id);
    const meta: Partial<ItemSales> = a ?? s60.get(id) ?? before.get(id) ?? {};
    const units = a?.u ?? 0;
    const units28 = s28.get(id)?.u ?? 0;
    const sold60 = (s60.get(id)?.u ?? 0) > 0;
    // Items with no sales in 60 days and no stock are old lines: leave them out.
    if (!a && !sold60 && (!st || st.stock <= 0)) continue;
    const stockQty = st ? st.stock : null;
    const perDay = units28 / window28;
    const cover = stockQty === null ? null : perDay > 0 ? Math.max(0, stockQty) / perDay : null;
    const isFast = fast.has(id);
    const status: MerchItem["status"] =
      stockQty === null
        ? "no_stock_data"
        : stockQty <= 0 && sold60
          ? "out"
          : cover !== null && cover < REORDER_DAYS
            ? "low"
            : stockQty > 0 && (cover === null ? !sold60 : cover > OVERSTOCK_DAYS)
              ? "over"
              : "ok";
    items.push({
      id,
      name: st?.name || meta.n || "Item",
      sku: st?.sku || meta.s || null,
      category: (st?.category || meta.c || "Not categorised").toUpperCase(),
      net: a?.v ?? 0,
      units,
      momNet: momOk ? before.get(id)?.v ?? 0 : null,
      lflNet: lflOk ? lastYear.get(id)?.v ?? 0 : null,
      units28,
      stock: stockQty,
      rate: st?.rate ?? null,
      sellThrough: stockQty === null ? null : units + Math.max(0, stockQty) > 0 ? units / (units + Math.max(0, stockQty)) : null,
      cover,
      outSince: st && st.stock <= 0 ? st.out_since : null,
      fast: isFast,
      status,
    });
  }

  const blank = (name: string): MerchCategory => ({
    name, net: 0, units: 0, momNet: momOk ? 0 : null, lflNet: lflOk ? 0 : null, stock: 0, stockValue: 0, units28: 0, sellThrough: null, cover: null, stockOuts: 0, lowFast: 0, overstock: 0, items: 0,
  });
  const cats = new Map<string, MerchCategory>();
  const total = blank("All categories");
  for (const it of items) {
    const c = cats.get(it.category) ?? blank(it.category);
    cats.set(it.category, c);
    for (const x of [c, total]) {
      x.net += it.net;
      x.units += it.units;
      if (x.momNet !== null) x.momNet += it.momNet ?? 0;
      if (x.lflNet !== null) x.lflNet += it.lflNet ?? 0;
      x.stock += Math.max(0, it.stock ?? 0);
      x.stockValue += Math.max(0, it.stock ?? 0) * (it.rate ?? 0);
      x.units28 += it.units28;
      if (it.status === "out") x.stockOuts++;
      if (it.fast && (it.status === "out" || it.status === "low")) x.lowFast++;
      if (it.status === "over") x.overstock++;
      x.items++;
    }
  }
  // Items sold last month / last year that are not in this month's list still count in the comparison.
  const listed = new Set(items.map((i) => i.id));
  for (const [src, field, ok] of [[before, "momNet", momOk], [lastYear, "lflNet", lflOk]] as const) {
    if (!ok) continue;
    for (const [id, r] of src) {
      if (listed.has(id)) continue;
      if (isCarryBag(r.c)) continue;
      const cat = (stockById.get(id)?.category || r.c || "Not categorised").toUpperCase();
      const c = cats.get(cat) ?? blank(cat);
      cats.set(cat, c);
      c[field] = (c[field] ?? 0) + r.v;
      total[field] = (total[field] ?? 0) + r.v;
    }
  }
  for (const x of [...cats.values(), total]) {
    x.sellThrough = x.units + x.stock > 0 ? x.units / (x.units + x.stock) : null;
    x.cover = x.units28 > 0 ? x.stock / (x.units28 / window28) : null;
  }
  const stockAt = stock.reduce<string | null>((m, r) => (!m || r.updated_at > m ? r.updated_at : m), null);
  const value: MerchReport = {
    store,
    month,
    today,
    periods: { mtd, mom, lfl },
    momCoverage,
    lflCoverage,
    stockAt,
    totals: total,
    categories: [...cats.values()].sort((a, b) => b.net - a.net),
    items: items.sort((a, b) => b.net - a.net),
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Change (0.12 = +12%), or null without a base. */
export const growth = (now: number, before: number | null) => (before === null || before <= 0 ? null : now / before - 1);
