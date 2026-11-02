// Works out the purchase behind a complaint from the invoice (bill) or warranty
// number the customer gives: bill, store, and the staff member who made the
// sale (Zoho POS salesperson, or whoever registered the warranty). Server only.

import { supabaseAdmin } from "@/lib/supabase/server";
import { fetchInvoiceByNumber } from "@/lib/zoho";

export type ResolvedReference = {
  reference: string;
  billNumber: string;
  billDate: string | null;
  storeName: string | null;
  warrantyId: string | null;
  staffName: string | null;
  staffId: string | null;
};

const normalise = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

/** Staff login whose name matches the Zoho salesperson name. */
async function staffByName(name: string | null) {
  if (!name) return null;
  const { data } = await supabaseAdmin.from("staff_users").select("id, full_name").eq("is_active", true);
  const wanted = normalise(name);
  return (data ?? []).find((s) => normalise(String(s.full_name)) === wanted) ?? null;
}

export async function resolveComplaintReference(
  raw: string,
  mobile: string
): Promise<{ ok: true; value: ResolvedReference } | { ok: false; error: string }> {
  const reference = raw.toUpperCase().replace(/[^A-Z0-9\-/]/g, "").slice(0, 60);
  if (!reference) {
    return { ok: false, error: "Enter your invoice (bill) number or warranty number — it is printed on your bill / certificate." };
  }

  // 1. A warranty number, or a bill that has a registered warranty.
  const { data: warranties } = await supabaseAdmin
    .from("warranties")
    .select("id, warranty_number, bill_number, bill_date, store_name, customer_mobile, registered_by, staff_users:registered_by ( id, full_name )")
    .or(`warranty_number.eq.${reference},bill_number.eq.${reference}`)
    .limit(20);

  const rows = (warranties ?? []) as unknown as {
    id: string;
    warranty_number: string;
    bill_number: string;
    bill_date: string;
    store_name: string | null;
    customer_mobile: string;
    staff_users: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
  }[];
  const warranty = rows.find((w) => w.customer_mobile === mobile) ?? rows[0] ?? null;
  const billNumber = warranty?.bill_number ?? reference;

  if (reference.startsWith("SY-WAR-") && !warranty) {
    return { ok: false, error: "We couldn't find this warranty number. Please check it (e.g. SY-WAR-2026-123456)." };
  }

  // 2. The bill in Zoho POS (salesperson + store).
  let invoice = null;
  try {
    invoice = await fetchInvoiceByNumber(billNumber);
  } catch (error) {
    console.warn("Zoho invoice lookup for complaint failed:", error);
  }

  if (!warranty && !invoice) {
    return {
      ok: false,
      error: "We couldn't find this invoice number. Please type it exactly as printed on your bill (e.g. VDK26-SI1-8504).",
    };
  }

  const registeredBy = warranty
    ? Array.isArray(warranty.staff_users)
      ? warranty.staff_users[0] ?? null
      : warranty.staff_users
    : null;

  // The salesperson on the bill; if Zoho has none, whoever registered the warranty.
  const salesperson = invoice?.salespersonName ?? null;
  const matched = await staffByName(salesperson);
  const staffName = salesperson ? matched?.full_name ?? salesperson : registeredBy?.full_name ?? null;
  const staffId = salesperson ? (matched ? String(matched.id) : null) : registeredBy ? String(registeredBy.id) : null;

  return {
    ok: true,
    value: {
      reference,
      billNumber: invoice?.billNumber ?? billNumber,
      billDate: invoice?.billDate ?? warranty?.bill_date ?? null,
      storeName: invoice?.storeName ?? warranty?.store_name ?? null,
      warrantyId: warranty && (warranty.customer_mobile === mobile || reference.startsWith("SY-WAR-")) ? warranty.id : null,
      staffName: staffName ? String(staffName).replace(/\s+/g, " ").trim() : null,
      staffId,
    },
  };
}
