// Copies bills (invoices) and returns (credit notes) from Zoho POS into Supabase for the
// sales performance dashboard. Server only.
//
// Only numbers, items, store and salesperson are kept, never customer names or phones.
// Each run handles a limited number of bills so it never holds a request for long and stays
// well inside Zoho's per-minute limit. Call it again until `pending` is 0.

import { supabaseAdmin } from "@/lib/supabase/server";
import { zohoConfigured, zohoRead } from "@/lib/zoho";
import { todayISO } from "@/lib/helpers";
import { loadPerformanceSettings, savePerformanceSettings } from "@/lib/performance-settings";

type Obj = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const round2 = (n: number) => Math.round(n * 100) / 100;

const SKIP_STATUS = new Set(["void", "draft"]);

/** "1014 - JIYANA" → "1014". Names without a number use the links saved in Settings. */
export function staffIdFromSalesperson(name: string, links: Record<string, string>) {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const linked = links[clean.toUpperCase()];
  if (linked) return linked;
  const m = clean.match(/^(\d{3,6})\b/);
  return m ? String(Number(m[1])) : null;
}

/** Carry bags are billed as items but are not counted as items sold. */
export const isCarryBag = (category: unknown) => /carry\s*bag/i.test(String(category ?? ""));

export const storeKey = (v: unknown) => str(v).replace(/\s+/g, " ").toUpperCase() || null;

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  });
  await Promise.all(runners);
}

async function listAll(path: string, key: string, date: string) {
  const out: Obj[] = [];
  for (let page = 1; page <= 30; page++) {
    const res = await zohoRead(path, { date_start: date, date_end: date, per_page: "200", page: String(page) });
    out.push(...arr(res[key]));
    if (!obj(res.page_context).has_more_page) break;
  }
  // Some lists ignore the date filter: keep only that day.
  return out.filter((r) => str(r.date) === date);
}

/** Item categories, from our own table first, then Zoho (in bulk) for new items. */
async function categoriesFor(itemIds: string[]) {
  const result = new Map<string, string>();
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!ids.length) return result;
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabaseAdmin.from("sales_item_categories").select("item_id, category").in("item_id", ids.slice(i, i + 200));
    for (const r of data ?? []) result.set(r.item_id, r.category);
  }
  const missing = ids.filter((id) => !result.has(id));
  const found: { item_id: string; category: string; updated_at: string }[] = [];
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    try {
      const res = await zohoRead("itemdetails", { item_ids: chunk.join(",") });
      for (const item of arr(res.items)) {
        const category = str(item.category_name) || str(item.group_name);
        if (category) result.set(str(item.item_id), category);
      }
    } catch (error) {
      console.warn("Item categories bulk lookup failed (trying one by one):", error);
    }
  }
  // Items the bulk lookup did not answer: one by one (each item only once, then it is kept).
  await pool(
    missing.filter((id) => !result.has(id)),
    2,
    async (id) => {
      try {
        const item = obj((await zohoRead(`items/${id}`)).item);
        result.set(id, str(item.category_name) || str(item.group_name));
      } catch (error) {
        console.warn(`Item ${id} category lookup failed:`, error);
      }
    }
  );
  for (const id of missing) if (result.has(id)) found.push({ item_id: id, category: result.get(id) ?? "", updated_at: new Date().toISOString() });
  if (found.length) await supabaseAdmin.from("sales_item_categories").upsert(found);
  return result;
}

type SyncLinks = Record<string, string>;

async function saveInvoice(listRow: Obj, links: SyncLinks) {
  const d = obj((await zohoRead(`invoices/${str(listRow.invoice_id)}`)).invoice);
  const lines = arr(d.line_items);
  const categories = await categoriesFor(lines.map((l) => str(l.item_id)));
  const inclusive = d.is_inclusive_tax === true;

  const salesperson = (str(d.salesperson_name) || str(listRow.salesperson_name)).replace(/\s+/g, " ");
  const staffUserId = staffIdFromSalesperson(salesperson, links);
  const store = storeKey(d.location_name || d.branch_name || listRow.location_name);
  const date = str(d.date || listRow.date);
  const invoiceId = str(d.invoice_id || listRow.invoice_id);

  let gross = 0;
  let quantity = 0;
  let under5k = 0;
  const cats = new Set<string>();
  const rows = lines.map((l) => {
    const qty = num(l.quantity);
    const price = num(l.rate);
    const taxPct = num(l.tax_percentage);
    const lineNet = num(l.item_total);
    const lineGross = inclusive ? (price * qty) / (1 + taxPct / 100) : price * qty;
    gross += lineGross;
    const itemId = str(l.item_id) || null;
    const category = str(l.category_name) || (itemId ? categories.get(itemId) ?? "" : "");
    // Carry bags are not "items sold" (WOW bill counts, items per bill).
    if (!isCarryBag(category)) {
      quantity += qty;
      if (price > 0 && price < 5000) under5k += qty;
      if (category) cats.add(category.toUpperCase());
    }
    return {
      line_item_id: str(l.line_item_id),
      invoice_id: invoiceId,
      invoice_date: date,
      staff_user_id: staffUserId,
      store,
      item_id: itemId,
      sku: str(l.sku) || null,
      name: (str(l.name) || str(l.description) || "Item").slice(0, 200),
      category: category || null,
      quantity: qty,
      price: round2(price),
      discount: round2(Math.max(0, lineGross - lineNet)),
      net: round2(lineNet),
    };
  });

  // Amount after every discount, without tax.
  const taxable = num(d.total_taxable_amount);
  const billDiscount = str(d.discount_type) === "entity_level" ? num(d.discount_total) : 0;
  const net = taxable > 0 ? taxable : Math.max(0, num(d.sub_total) - billDiscount);
  const counted = rows.filter((r) => !isCarryBag(r.category));
  const maxLine = counted.reduce((m, r) => Math.max(m, r.net), 0);
  const lineSum = counted.reduce((s, r) => s + r.net, 0);

  const invoice = {
    invoice_id: invoiceId,
    invoice_number: str(d.invoice_number || listRow.invoice_number),
    invoice_date: date,
    store,
    location_name: str(d.location_name || d.branch_name) || null,
    salesperson: salesperson || null,
    staff_user_id: staffUserId,
    status: str(d.status || listRow.status) || null,
    gross: round2(gross),
    discount: round2(Math.max(0, gross - net)),
    net: round2(net),
    total: round2(num(d.total)),
    quantity,
    line_count: rows.length,
    category_count: cats.size,
    units_under_5k: under5k,
    max_line_share: lineSum > 0 ? Math.round((maxLine / lineSum) * 10000) / 10000 : 0,
    modified_at: str(listRow.last_modified_time || d.last_modified_time) || null,
    synced_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("sales_invoices").upsert(invoice);
  if (error) throw error;
  await supabaseAdmin.from("sales_invoice_lines").delete().eq("invoice_id", invoiceId);
  if (rows.length) {
    const { error: lineError } = await supabaseAdmin.from("sales_invoice_lines").upsert(rows);
    if (lineError) throw lineError;
  }
}

async function saveCreditNote(listRow: Obj, links: SyncLinks) {
  const d = obj((await zohoRead(`creditnotes/${str(listRow.creditnote_id)}`)).creditnote);
  const lines = arr(d.line_items);
  const id = str(d.creditnote_id || listRow.creditnote_id);
  const date = str(d.date || listRow.date);
  const inclusive = d.is_inclusive_tax === true;

  // The bill it was returned against: from the lines, else the invoices list.
  const invoiceId = str(lines.find((l) => str(l.invoice_id))?.invoice_id) || str(arr(d.invoices)[0]?.invoice_id) || null;
  let invoiceNumber = str(arr(d.invoices)[0]?.invoice_number) || null;

  // The return counts against the person who made the original sale.
  let staffUserId: string | null = null;
  let store = storeKey(d.location_name || d.branch_name || listRow.location_name);
  let salesperson = (str(d.salesperson_name) || str(listRow.salesperson_name)).replace(/\s+/g, " ");
  if (invoiceId) {
    const { data: inv } = await supabaseAdmin
      .from("sales_invoices")
      .select("staff_user_id, store, salesperson, invoice_number")
      .eq("invoice_id", invoiceId)
      .maybeSingle();
    if (inv) {
      staffUserId = inv.staff_user_id;
      store = store || inv.store;
      salesperson = salesperson || inv.salesperson || "";
      invoiceNumber = invoiceNumber || inv.invoice_number;
    } else {
      try {
        const orig = obj((await zohoRead(`invoices/${invoiceId}`)).invoice);
        salesperson = salesperson || str(orig.salesperson_name);
        store = store || storeKey(orig.location_name || orig.branch_name);
        invoiceNumber = invoiceNumber || str(orig.invoice_number) || null;
        staffUserId = staffIdFromSalesperson(str(orig.salesperson_name), links);
      } catch {
        /* the original bill could not be read; fall back to the credit note's own salesperson */
      }
    }
  }
  if (!staffUserId) staffUserId = staffIdFromSalesperson(salesperson, links);
  if (!store) store = storeKey(lines.map((l) => str(l.location_name) || str(l.warehouse_name)).find(Boolean));

  const rows = lines.map((l) => {
    const qty = num(l.quantity);
    const lineNet = num(l.item_total) || (inclusive ? (num(l.rate) * qty) / (1 + num(l.tax_percentage) / 100) : num(l.rate) * qty);
    return {
      line_item_id: str(l.line_item_id),
      creditnote_id: id,
      return_date: date,
      staff_user_id: staffUserId,
      store,
      item_id: str(l.item_id) || null,
      sku: str(l.sku) || null,
      name: (str(l.name) || "Item").slice(0, 200),
      quantity: qty,
      net: round2(lineNet),
    };
  });
  const taxable = num(d.total_taxable_amount) || num(d.sub_total);
  const net = taxable > 0 ? taxable : rows.reduce((s, r) => s + r.net, 0);

  const { error } = await supabaseAdmin.from("sales_returns").upsert({
    creditnote_id: id,
    creditnote_number: str(d.creditnote_number || listRow.creditnote_number),
    return_date: date,
    store,
    location_name: str(d.location_name || d.branch_name) || null,
    salesperson: salesperson || null,
    staff_user_id: staffUserId,
    invoice_id: invoiceId,
    invoice_number: invoiceNumber,
    status: str(d.status || listRow.status) || null,
    net: round2(net),
    total: round2(num(d.total)),
    modified_at: str(listRow.last_modified_time || d.last_modified_time) || null,
    synced_at: new Date().toISOString(),
  });
  if (error) throw error;
  await supabaseAdmin.from("sales_return_lines").delete().eq("creditnote_id", id);
  if (rows.length) {
    const { error: lineError } = await supabaseAdmin.from("sales_return_lines").upsert(rows);
    if (lineError) throw lineError;
  }
}

export type DaySync = {
  date: string;
  bills: number;
  billsSaved: number;
  returns: number;
  returnsSaved: number;
  pending: number;
  returnsError?: string;
  error?: string;
};

/** Bring one day up to date. `budget` = most bills / returns read in detail this time. */
export async function syncSalesDay(date: string, budget = 40): Promise<DaySync> {
  const result: DaySync = { date, bills: 0, billsSaved: 0, returns: 0, returnsSaved: 0, pending: 0 };
  if (!(await zohoConfigured())) return { ...result, error: "Zoho POS is not connected." };
  const settings = await loadPerformanceSettings();
  const links = Object.fromEntries(Object.entries(settings.salespersonLinks ?? {}).map(([k, v]) => [k.toUpperCase(), v]));

  // ---- Bills
  const list = await listAll("invoices", "invoices", date);
  const keep = list.filter((r) => !SKIP_STATUS.has(str(r.status).toLowerCase()));
  result.bills = keep.length;
  const { data: saved } = await supabaseAdmin.from("sales_invoices").select("invoice_id, modified_at").eq("invoice_date", date).limit(5000);
  const savedMap = new Map((saved ?? []).map((r) => [r.invoice_id as string, r.modified_at as string | null]));
  const keepIds = new Set(keep.map((r) => str(r.invoice_id)));
  const gone = [...savedMap.keys()].filter((id) => !keepIds.has(id));
  if (gone.length) await supabaseAdmin.from("sales_invoices").delete().in("invoice_id", gone);

  const todo = keep.filter((r) => {
    const id = str(r.invoice_id);
    return !savedMap.has(id) || (str(r.last_modified_time) && savedMap.get(id) !== str(r.last_modified_time));
  });
  const now = todo.slice(0, budget);
  let failed = 0;
  await pool(now, 3, async (row) => {
    try {
      await saveInvoice(row, links);
      result.billsSaved++;
    } catch (error) {
      failed++;
      console.error("Sales sync: bill failed", str(row.invoice_number), error);
    }
  });
  result.pending += todo.length - result.billsSaved;
  let left = Math.max(0, budget - now.length);

  // ---- Returns (needs the credit notes permission in the Zoho connection)
  try {
    const cnList = await listAll("creditnotes", "creditnotes", date);
    const cnKeep = cnList.filter((r) => !SKIP_STATUS.has(str(r.status).toLowerCase()));
    result.returns = cnKeep.length;
    const { data: cnSaved } = await supabaseAdmin.from("sales_returns").select("creditnote_id, modified_at").eq("return_date", date).limit(2000);
    const cnMap = new Map((cnSaved ?? []).map((r) => [r.creditnote_id as string, r.modified_at as string | null]));
    const cnIds = new Set(cnKeep.map((r) => str(r.creditnote_id)));
    const cnGone = [...cnMap.keys()].filter((id) => !cnIds.has(id));
    if (cnGone.length) await supabaseAdmin.from("sales_returns").delete().in("creditnote_id", cnGone);
    const cnTodo = cnKeep.filter((r) => {
      const id = str(r.creditnote_id);
      return !cnMap.has(id) || (str(r.last_modified_time) && cnMap.get(id) !== str(r.last_modified_time));
    });
    const cnNow = cnTodo.slice(0, Math.max(left, 5));
    left = Math.max(0, left - cnNow.length);
    await pool(cnNow, 3, async (row) => {
      try {
        await saveCreditNote(row, links);
        result.returnsSaved++;
      } catch (error) {
        console.error("Sales sync: return failed", str(row.creditnote_number), error);
      }
    });
    result.pending += cnTodo.length - result.returnsSaved;
  } catch (error) {
    result.returnsError = error instanceof Error ? error.message : String(error);
  }
  if (failed && !result.error) result.error = `${failed} bill(s) could not be read; they will be tried again.`;
  return result;
}

/** Scheduled run: today and the two days before (catches late edits and returns). */
export async function syncRecentSales() {
  if (!(await zohoConfigured())) return null;
  const days = [0, 1, 2].map((n) => todayISO(new Date(Date.now() - n * 86_400_000)));
  const out: DaySync[] = [];
  let budget = 60;
  for (const day of days) {
    if (budget <= 0) break;
    const r = await syncSalesDay(day, budget);
    budget -= r.billsSaved + r.returnsSaved;
    out.push(r);
  }
  await savePerformanceSettings({
    lastSyncAt: new Date().toISOString(),
    returnsError: out.find((r) => r.returnsError)?.returnsError ?? null,
  });
  return out;
}
