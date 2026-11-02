// Creating a complaint — shared by the website form, WhatsApp and the Aira chatbot (server only).

import { supabaseAdmin } from "@/lib/supabase/server";
import { cleanMobile, generateTicketNumber, isValidMobile } from "@/lib/helpers";
import { COMPLAINT_CATEGORIES } from "@/lib/site-config";
import { announceNewTicket, initialDeadlines } from "@/lib/tickets";
import { getStores, matchStore } from "@/lib/stores";

export type ComplaintSource = "web" | "whatsapp" | "aira";

export const SOURCE_LABELS: Record<ComplaintSource, string> = {
  web: "Website",
  whatsapp: "WhatsApp",
  aira: "Aira chatbot",
};

export type NewComplaint = {
  fullName: string;
  mobile: string;
  email?: string | null;
  storeName?: string | null;
  category: string;
  reference?: string | null;
  description: string;
  source: ComplaintSource;
};

export type CreateResult =
  | { ok: true; id: string; complaintNumber: string; status: string; createdAt: string; announce: () => Promise<void> }
  | { ok: false; error: string; status: number };

/** Category as given, or the closest match (or "Other") for chat channels. */
export function pickCategory(value: string | null | undefined) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return "Other";
  const exact = COMPLAINT_CATEGORIES.find((c) => c.toLowerCase() === v);
  if (exact) return exact;
  const partial = COMPLAINT_CATEGORIES.find((c) => c.toLowerCase().includes(v) || v.includes(c.toLowerCase().split(" ")[0]));
  return partial ?? "Other";
}

export async function createComplaint(input: NewComplaint): Promise<CreateResult> {
  const fullName = input.fullName.trim().slice(0, 120);
  const mobile = cleanMobile(input.mobile);
  const email = String(input.email ?? "").trim();
  const category = input.category.trim();
  const reference = String(input.reference ?? "").trim().slice(0, 60);
  const description = input.description.trim().slice(0, 3000);

  if (!fullName) return { ok: false, error: "Please enter your name.", status: 400 };
  if (!isValidMobile(mobile)) return { ok: false, error: "Enter a valid 10-digit Indian mobile number.", status: 400 };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email address is not valid.", status: 400 };
  }
  if (!COMPLAINT_CATEGORIES.includes(category)) {
    return { ok: false, error: "Please choose what the complaint is about.", status: 400 };
  }
  if (description.length < 10) {
    return { ok: false, error: "Please describe the issue in a little more detail.", status: 400 };
  }

  // Store names come from Zoho POS (same names as on the bills).
  let storeName: string | null = null;
  if (input.storeName?.trim()) {
    const store = matchStore((await getStores()).stores, input.storeName);
    if (!store) return { ok: false, error: "Please choose the store from the list.", status: 400 };
    storeName = store.name;
  }

  // Link to a warranty when the reference (warranty or bill number) belongs to this mobile.
  let warrantyId: string | null = null;
  {
    const { data: owned } = await supabaseAdmin
      .from("warranties")
      .select("id, warranty_number, bill_number, store_name")
      .eq("customer_mobile", mobile);
    const ref = reference.toUpperCase();
    const match = ref
      ? (owned ?? []).find(
          (w) => String(w.warranty_number).toUpperCase() === ref || String(w.bill_number).toUpperCase() === ref
        )
      : null;
    warrantyId = match?.id ?? null;
    // No store chosen? Use the store the product was bought from (or their only store).
    if (!storeName && match?.store_name) storeName = match.store_name;
    if (!storeName) {
      const stores = [...new Set((owned ?? []).map((w) => w.store_name).filter(Boolean))];
      if (stores.length === 1) storeName = String(stores[0]);
    }
  }

  let complaintNumber = generateTicketNumber("CMP");
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: clash } = await supabaseAdmin
      .from("complaints")
      .select("id")
      .eq("complaint_number", complaintNumber)
      .maybeSingle();
    if (!clash) break;
    complaintNumber = generateTicketNumber("CMP");
  }

  const row = {
    complaint_number: complaintNumber,
    contact_name: fullName,
    contact_mobile: mobile,
    contact_email: email || null,
    warranty_id: warrantyId,
    category,
    reference_number: reference || null,
    description,
    store_name: storeName,
    status: "open",
    priority: "normal",
    source: input.source,
    ...initialDeadlines("complaint", "normal"),
  };

  let result = await supabaseAdmin.from("complaints").insert(row).select("id, complaint_number, status, created_at").single();
  if (result.error && /source/.test(result.error.message ?? "")) {
    // Database not upgraded yet (no "source" column) — save without it.
    const { source: _source, ...withoutSource } = row;
    void _source;
    result = await supabaseAdmin.from("complaints").insert(withoutSource).select("id, complaint_number, status, created_at").single();
  }
  if (result.error || !result.data) {
    console.error("Create complaint error:", result.error);
    return { ok: false, error: "Unable to register the complaint. Please try again.", status: 500 };
  }
  const created = result.data;

  const announce = () =>
    announceNewTicket({
      type: "complaint",
      id: created.id,
      number: created.complaint_number,
      storeName,
      title: category,
      summary: `${category} · Customer: ${fullName} (${mobile}) · via ${SOURCE_LABELS[input.source]}`,
      details: [`Complaint: ${description}`, ...(reference ? [`Reference: ${reference}`] : [])],
      priority: "normal",
      customer: { name: fullName, mobile, email: email || null },
    }).catch((error) => console.error("New complaint alerts failed:", error));

  return {
    ok: true,
    id: created.id,
    complaintNumber: created.complaint_number,
    status: created.status,
    createdAt: created.created_at,
    announce,
  };
}
