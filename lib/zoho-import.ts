// Bulk import: create warranties for every warranty-eligible item on Zoho POS
// bills in a date range. Runs in small batches (the Super Admin page keeps
// calling it) and remembers where it stopped, so it can be resumed.
// No WhatsApp / SMS / feedback messages are sent to customers.

import { supabaseAdmin } from "@/lib/supabase/server";
import { ensureCustomerAccount } from "@/lib/customer-auth";
import { addMonths, todayISO } from "@/lib/helpers";
import { buildWarrantyRows } from "@/lib/warranty-rules";
import { fetchBillFromList, listInvoices, ZohoError } from "@/lib/zoho";

const KEY = "zoho_import";
const BATCH = 6; // bills per call (each bill = 1–3 Zoho requests)
export const NOT_RECORDED = "Not recorded";

export type ImportState = {
  from: string;
  to: string;
  page: number;
  index: number; // next invoice on this page
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
  return v && v.from ? v : null;
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
    page: 1,
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

/** Process the next few bills. Returns the updated progress. */
export async function runImportBatch(staffId: string): Promise<{ state: ImportState; pause?: string }> {
  const state = await loadImportState();
  if (!state) throw new Error("No import has been started.");
  if (state.done) return { state };

  const { invoices, hasMore } = await listInvoices(state.from, state.to, state.page);
  const slice = invoices.slice(state.index, state.index + BATCH);
  const categoryCache = new Map<string, string>();
  const usedNumbers = new Set<string>();
  let pause: string | undefined;

  for (const inv of slice) {
    try {
      if (["void", "draft"].includes(inv.status)) {
        state.skippedStatus++;
      } else {
        const bill = await fetchBillFromList(inv, categoryCache);
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
      if (error instanceof ZohoError) {
        // Most often Zoho's "too many requests" limit — stop here and retry this bill after a pause.
        pause = error.message;
        break;
      }
      state.failed = [...state.failed, { bill: inv.billNumber, reason: error instanceof Error ? error.message : "Error" }].slice(-50);
      state.bills++;
      state.index++;
    }
  }

  if (!pause && state.index >= invoices.length) {
    if (hasMore) {
      state.page++;
      state.index = 0;
    } else {
      state.done = true;
    }
  }

  await saveState(state);
  return { state, pause };
}
