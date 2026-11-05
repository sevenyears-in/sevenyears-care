// Bulk import: create warranties for every warranty-eligible item on Zoho POS
// bills in a date range. Runs in small batches (the Super Admin page keeps
// calling it) and remembers where it stopped, so it can be resumed.
// No WhatsApp / SMS / feedback messages are sent to customers.

import { supabaseAdmin } from "@/lib/supabase/server";
import { ensureCustomerAccount } from "@/lib/customer-auth";
import { addMonths, todayISO } from "@/lib/helpers";
import { buildWarrantyRows, loadActiveCategories } from "@/lib/warranty-rules";
import { fetchBillFromList, listInvoicesForItem, listItems, ZohoError, type InvoiceListItem } from "@/lib/zoho";

const KEY = "zoho_import";
const BATCH = 6; // bills per call (each bill = 1–3 Zoho requests)
export const NOT_RECORDED = "Not recorded";

export type ImportState = {
  from: string;
  to: string;
  /** items → find warranty items; bills → find their bills; process → add warranties */
  phase: "items" | "bills" | "process";
  page: number; // Zoho page within the current step
  itemIds: string[]; // items in active warranty categories
  itemCursor: number;
  queue: Pick<InvoiceListItem, "invoiceId" | "billNumber" | "billDate" | "status" | "raw">[];
  index: number; // next bill in the queue
  done: boolean;
  startedAt: string;
  updatedAt: string;
  startedBy: string;
  bills: number; // bills checked
  billsWithItems: number;
  created: number; // warranties added
  alreadyThere: number; // units already registered
  noMobile: number; // bills skipped: no customer mobile in Zoho
  skippedStatus: number; // void / draft bills
  failed: { bill: string; reason: string }[];
};

export async function loadImportState(): Promise<ImportState | null> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  const v = data?.value as ImportState | undefined;
  return v && v.from && v.phase ? v : null; // older format → start again
}

async function saveState(state: ImportState) {
  state.updatedAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ key: KEY, value: state, updated_at: state.updatedAt });
  if (error) throw error;
}

export async function startImport(from: string, to: string, staffName: string) {
  const now = new Date().toISOString();
  const state: ImportState = {
    from,
    to,
    phase: "items",
    page: 1,
    itemIds: [],
    itemCursor: 0,
    queue: [],
    index: 0,
    done: false,
    startedAt: now,
    updatedAt: now,
    startedBy: staffName,
    bills: 0,
    billsWithItems: 0,
    created: 0,
    alreadyThere: 0,
    noMobile: 0,
    skippedStatus: 0,
    failed: [],
  };
  await saveState(state);
  return state;
}

function warrantyNumber(taken: Set<string>) {
  const year = todayISO().slice(0, 4);
  let n = "";
  do n = `SY-WAR-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
  while (taken.has(n));
  taken.add(n);
  return n;
}

/** Do the next piece of work (a few Zoho requests). Returns the updated progress. */
export async function runImportBatch(staffId: string): Promise<{ state: ImportState; pause?: string }> {
  const state = await loadImportState();
  if (!state) throw new Error("No import has been started.");
  if (state.done) return { state };
  if (!state.phase) throw new Error("This import was started by an older version. Click Start again.");

  let pause: string | undefined;
  try {
    if (state.phase === "items") await findItems(state);
    else if (state.phase === "bills") await findBills(state);
    else pause = await processBills(state, staffId);
  } catch (error) {
    if (!(error instanceof ZohoError)) throw error;
    pause = error.message; // usually Zoho's "too many requests" limit — retried after a pause
  }

  await saveState(state);
  return { state, pause };
}

async function findItems(state: ImportState) {
  const categories = await loadActiveCategories();
  for (let i = 0; i < 5; i++) {
    const { items, hasMore } = await listItems(state.page);
    for (const it of items) {
      if (it.itemId && categories.has(it.category.trim().toLowerCase()) && !state.itemIds.includes(it.itemId)) {
        state.itemIds.push(it.itemId);
      }
    }
    if (!hasMore) {
      state.phase = "bills";
      state.page = 1;
      return;
    }
    state.page++;
  }
}

async function findBills(state: ImportState) {
  const seen = new Set(state.queue.map((q) => q.invoiceId));
  for (let calls = 0; calls < 12; calls++) {
    if (state.itemCursor >= state.itemIds.length) {
      state.queue.sort((a, b) => a.billDate.localeCompare(b.billDate));
      state.phase = "process";
      state.index = 0;
      if (state.queue.length === 0) state.done = true;
      return;
    }
    const { invoices, hasMore } = await listInvoicesForItem(state.itemIds[state.itemCursor], state.from, state.to, state.page);
    for (const inv of invoices) {
      if (seen.has(inv.invoiceId)) continue;
      seen.add(inv.invoiceId);
      state.queue.push(inv);
    }
    if (hasMore) state.page++;
    else {
      state.itemCursor++;
      state.page = 1;
    }
  }
}

async function processBills(state: ImportState, staffId: string): Promise<string | undefined> {
  const slice = state.queue.slice(state.index, state.index + BATCH);
  const categoryCache = new Map<string, string>();
  const usedNumbers = new Set<string>();

  for (const inv of slice) {
    try {
      if (["void", "draft"].includes(inv.status)) {
        state.skippedStatus++;
      } else {
        const bill = await fetchBillFromList(inv as InvoiceListItem, categoryCache);
        const { rows } = await buildWarrantyRows(bill);
        const fresh = rows.filter((r) => !r.existing);
        state.alreadyThere += rows.length - fresh.length;

        if (rows.length > 0) state.billsWithItems++;
        if (fresh.length > 0 && !bill.customer.mobile) {
          state.noMobile++;
        } else if (fresh.length > 0) {
          const records = fresh.map((row) => {
            const expiry = addMonths(bill.billDate, row.standardMonths);
            return {
              warranty_number: warrantyNumber(usedNumbers),
              zoho_invoice_id: bill.invoiceId,
              bill_number: bill.billNumber,
              bill_date: bill.billDate,
              store_name: bill.storeName,
              zoho_line_item_id: row.lineItemId,
              zoho_item_id: row.itemId,
              unit_index: row.unitIndex,
              product_name: row.productName,
              sku: row.sku,
              category_name: row.categoryName,
              model_number: row.suggestedModel || row.productName,
              serial_number: NOT_RECORDED,
              customer_name: bill.customer.name || "Customer",
              customer_mobile: bill.customer.mobile,
              customer_address: bill.customer.address || NOT_RECORDED,
              warranty_start_date: bill.billDate,
              standard_warranty_expiry_date: expiry,
              extended_warranty_purchased: false,
              extended_warranty_fee: 0,
              warranty_expiry_date: expiry,
              status: "active",
              registered_by: staffId,
              source: "zoho_import",
            };
          });

          const { data, error } = await supabaseAdmin
            .from("warranties")
            .upsert(records, { onConflict: "bill_number,bill_date,zoho_line_item_id,unit_index", ignoreDuplicates: true })
            .select("id");
          if (error) throw error;
          const added = data?.length ?? 0;
          state.created += added;
          state.alreadyThere += records.length - added;
          if (added > 0) {
            await ensureCustomerAccount(bill.customer.mobile, bill.customer.name, bill.billNumber).catch(() => null);
          }
        }
      }
      state.bills++;
      state.index++;
    } catch (error) {
      if (error instanceof ZohoError) return error.message; // retry this bill after a pause
      state.failed = [...state.failed, { bill: inv.billNumber, reason: error instanceof Error ? error.message : "Error" }].slice(-50);
      state.bills++;
      state.index++;
    }
  }

  if (state.index >= state.queue.length) state.done = true;
  return undefined;
}
