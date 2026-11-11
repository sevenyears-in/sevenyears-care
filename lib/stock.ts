// Stock per store from Zoho POS (server only).
//
// Read once a night (11:30 pm, before the night copy of earlier months) or on demand by the
// Super Admin. Active items are listed 200 at a time; their stock per store comes from the bulk
// item details (50 items a request). Typical cost: (items ÷ 200) + (items ÷ 50) requests.
// Keeps: current stock per store and item, the stock on the 1st of each month, and the days a
// recently-selling item was out of stock.

import { supabaseAdmin } from "@/lib/supabase/server";
import { flushZohoUsage, zohoCallsLastMinute, zohoConfigured, zohoRead } from "@/lib/zoho";
import { todayISO } from "@/lib/helpers";
import { isCarryBag, storeKey } from "@/lib/sales-sync";

type Obj = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

export const STOCK_KEY = "stock_read";
export type StockReadState = {
  lastAt: string | null;
  items: number;
  rows: number;
  reads: number;
  stores: string[];
  note: string | null;
  alerts: Record<string, { low: number; out: number; at: string }>;
};

export async function loadStockState(): Promise<StockReadState> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", STOCK_KEY).maybeSingle();
  const v = (data?.value ?? {}) as Partial<StockReadState>;
  return { lastAt: v.lastAt ?? null, items: v.items ?? 0, rows: v.rows ?? 0, reads: v.reads ?? 0, stores: v.stores ?? [], note: v.note ?? null, alerts: v.alerts ?? {} };
}
export async function saveStockState(change: Partial<StockReadState>) {
  const value = { ...(await loadStockState()), ...change };
  await supabaseAdmin.from("app_settings").upsert({ key: STOCK_KEY, value, updated_at: new Date().toISOString() });
  return value;
}

/** Stock per store from one item's details (Zoho uses "locations" or "warehouses"). */
function stockByStore(item: Obj): Map<string, number> {
  const out = new Map<string, number>();
  for (const key of ["locations", "warehouses", "branches"]) {
    for (const l of arr(item[key])) {
      const name = str(l.location_name) || str(l.warehouse_name) || str(l.branch_name) || str(l.name);
      const store = storeKey(name);
      if (!store) continue;
      const stock =
        l.location_stock_on_hand ?? l.warehouse_stock_on_hand ?? l.branch_stock_on_hand ?? l.stock_on_hand ?? l.location_available_stock ?? l.warehouse_available_stock;
      out.set(store, (out.get(store) ?? 0) + num(stock));
    }
    if (out.size) break;
  }
  return out;
}

const pace = async () => {
  while (zohoCallsLastMinute() >= 75) await new Promise((r) => setTimeout(r, 2000));
};

let running = false;
export const isStockReading = () => running;

/** Reads stock for every active item and store. `maxReads` keeps it inside the day's quota. */
export async function readStockFromZoho(maxReads = 600): Promise<string> {
  if (running) return "already running";
  if (!(await zohoConfigured())) return "Zoho POS is not connected";
  running = true;
  let reads = 0;
  try {
    // 1. Active items, 200 a request.
    const items: Obj[] = [];
    for (let page = 1; page <= 200; page++) {
      if (reads >= maxReads) throw new Error("Stopped to stay inside the Zoho request limit while listing items.");
      await pace();
      const res = await zohoRead("items", { per_page: "200", page: String(page), filter_by: "Status.Active" });
      reads++;
      items.push(...arr(res.items));
      if (!obj(res.page_context).has_more_page) break;
    }
    const meta = new Map(
      items
        .filter((i) => str(i.item_id) && i.is_combo_product !== true && str(i.product_type) !== "service" && str(i.item_type) !== "service")
        .map((i) => [str(i.item_id), { sku: str(i.sku) || null, name: (str(i.name) || "Item").slice(0, 200), category: str(i.category_name) || null, rate: num(i.rate) }])
    );
    const ids = [...meta.keys()];

    // 2. Stock per store, 50 items a request.
    const rows: { store: string; item_id: string; sku: string | null; name: string; category: string | null; rate: number; stock: number }[] = [];
    const stores = new Set<string>();
    for (let i = 0; i < ids.length; i += 50) {
      if (reads >= maxReads) throw new Error(`Stopped after ${reads} requests to stay inside the Zoho limit (${Math.round((i / ids.length) * 100)}% of items read).`);
      await pace();
      const res = await zohoRead("itemdetails", { item_ids: ids.slice(i, i + 50).join(",") });
      reads++;
      for (const it of arr(res.items)) {
        const id = str(it.item_id);
        const m = meta.get(id);
        if (!m) continue;
        for (const [store, stock] of stockByStore(it)) {
          stores.add(store);
          rows.push({ store, item_id: id, sku: m.sku, name: m.name, category: m.category || str(it.category_name) || null, rate: m.rate, stock });
        }
      }
    }
    if (!rows.length) throw new Error("Zoho returned no stock per store for the items (check the Zoho connection).");

    // 3. Save: current stock, out-of-stock date, month-opening stock.
    const today = todayISO();
    const month = today.slice(0, 7);
    const prevOut = new Map<string, string | null>();
    for (let start = 0; start < 200_000; start += 1000) {
      const { data } = await supabaseAdmin.from("stock_levels").select("store, item_id, out_since").range(start, start + 999);
      for (const r of data ?? []) prevOut.set(`${r.store}|${r.item_id}`, (r.out_since as string | null) ?? null);
      if (!data || data.length < 1000) break;
    }
    const now = new Date().toISOString();
    const save = rows.map((r) => ({
      ...r,
      out_since: r.stock <= 0 ? prevOut.get(`${r.store}|${r.item_id}`) || today : null,
      source: "zoho",
      updated_at: now,
    }));
    for (let i = 0; i < save.length; i += 500) {
      const { error } = await supabaseAdmin.from("stock_levels").upsert(save.slice(i, i + 500));
      if (error) throw error;
    }
    const { count: opened } = await supabaseAdmin.from("stock_month_open").select("item_id", { count: "exact", head: true }).eq("month", month);
    if (!opened) {
      const open = rows.map((r) => ({ month, store: r.store, item_id: r.item_id, stock: r.stock }));
      for (let i = 0; i < open.length; i += 500) await supabaseAdmin.from("stock_month_open").upsert(open.slice(i, i + 500));
    }
    // Out of stock today and sold in the last 60 days (old discontinued items are left out).
    const alerts: StockReadState["alerts"] = {};
    for (const store of stores) {
      const { lowFast, out } = await stockAlertsFor(store);
      alerts[store] = { low: lowFast, out: out.length, at: now };
      if (out.length) for (let i = 0; i < out.length; i += 500) await supabaseAdmin.from("stock_out_days").upsert(out.slice(i, i + 500).map((item_id) => ({ day: today, store, item_id })));
    }
    await saveStockState({ lastAt: now, items: ids.length, rows: rows.length, reads, stores: [...stores].sort(), note: null, alerts });
    return `read ${ids.length} items in ${stores.size} store(s) with ${reads} request(s)`;
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    await saveStockState({ note, reads }).catch(() => undefined);
    return `failed: ${note}`;
  } finally {
    running = false;
    await flushZohoUsage().catch(() => undefined);
  }
}

// ------------------------------------------------------------------
// Sales per item (database function merch_item_sales) and alerts
// ------------------------------------------------------------------

export type ItemSales = { k: string; n: string | null; s: string | null; c: string | null; u: number; v: number };

export async function itemSales(store: string, from: string, to: string): Promise<Map<string, ItemSales>> {
  const { data, error } = await supabaseAdmin.rpc("merch_item_sales", { p_store: store, p_from: from, p_to: to });
  if (error) throw error;
  const list = (Array.isArray(data) ? data : []) as ItemSales[];
  return new Map(list.filter((r) => !isCarryBag(r.c)).map((r) => [r.k, { ...r, u: num(r.u), v: num(r.v) }]));
}

export async function daysWithData(store: string, from: string, to: string): Promise<number> {
  const { data } = await supabaseAdmin.rpc("merch_days_with_data", { p_store: store, p_from: from, p_to: to });
  return num(data);
}

export type StockRow = { item_id: string; sku: string | null; name: string | null; category: string | null; rate: number | null; stock: number; out_since: string | null; updated_at: string };

export async function stockFor(store: string): Promise<StockRow[]> {
  const out: StockRow[] = [];
  for (let start = 0; start < 200_000; start += 1000) {
    const { data, error } = await supabaseAdmin
      .from("stock_levels")
      .select("item_id, sku, name, category, rate, stock, out_since, updated_at")
      .eq("store", store)
      .order("item_id")
      .range(start, start + 999);
    if (error) throw error;
    out.push(...((data ?? []) as StockRow[]).map((r) => ({ ...r, stock: num(r.stock) })));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Fast movers: items selling at least 4 units in 28 days, top fifth of them by units. */
export function fastMovers(sales28: Map<string, ItemSales>) {
  const sellers = [...sales28.values()].filter((r) => r.u >= 4).sort((a, b) => b.u - a.u);
  return new Set(sellers.slice(0, Math.max(1, Math.ceil(sellers.length * 0.2))).map((r) => r.k));
}

export const REORDER_DAYS = 7;
export const OVERSTOCK_DAYS = 90;

/** Count of fast movers under 7 days of cover (or out), and items out of stock that sold in 60 days. */
export async function stockAlertsFor(store: string) {
  const today = todayISO();
  const [s28, s60, stock] = await Promise.all([itemSales(store, addDays(today, -27), today), itemSales(store, addDays(today, -59), today), stockFor(store)]);
  const fast = fastMovers(s28);
  let lowFast = 0;
  const out: string[] = [];
  for (const r of stock) {
    const sold60 = (s60.get(r.item_id)?.u ?? 0) > 0;
    if (r.stock <= 0 && sold60) out.push(r.item_id);
    if (fast.has(r.item_id)) {
      const perDay = (s28.get(r.item_id)?.u ?? 0) / 28;
      if (r.stock <= 0 || (perDay > 0 && r.stock / perDay < REORDER_DAYS)) lowFast++;
    }
  }
  return { lowFast, out };
}
