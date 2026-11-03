// Creating a complaint — shared by the website form, WhatsApp and the Sevi chatbot (server only).

import { supabaseAdmin } from "@/lib/supabase/server";
import { cleanMobile, generateTicketNumber, isValidMobile } from "@/lib/helpers";
import { COMPLAINT_CATEGORIES } from "@/lib/site-config";
import { announceNewTicket, initialDeadlines } from "@/lib/tickets";
import { getStores, matchStore } from "@/lib/stores";
import { resolveComplaintReference } from "@/lib/complaint-reference";
import { complaintKind } from "@/lib/sla";
import { requestExplanation } from "@/lib/explanations";

export type ComplaintSource = "web" | "whatsapp" | "aira";

export const SOURCE_LABELS: Record<ComplaintSource, string> = {
  web: "Website",
  whatsapp: "WhatsApp",
  aira: "Sevi chatbot", // stored as "aira" (old name of the chatbot)
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
  | {
      ok: true;
      id: string;
      complaintNumber: string;
      status: string;
      createdAt: string;
      staffName: string | null;
      storeName: string | null;
      announce: () => Promise<void>;
    }
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

  // The invoice / warranty number is required: it tells us the store and the staff who made the sale.
  const resolved = await resolveComplaintReference(reference, mobile);
  if (!resolved.ok) return { ok: false, error: resolved.error, status: 400 };
  const ref = resolved.value;

  // Store: from the bill; otherwise the one the customer chose.
  let storeName: string | null = null;
  const storeList = (await getStores()).stores;
  if (ref.storeName) storeName = matchStore(storeList, ref.storeName)?.name ?? ref.storeName;
  if (!storeName && input.storeName?.trim()) storeName = matchStore(storeList, input.storeName)?.name ?? null;
  const warrantyId = ref.warrantyId;

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
    reference_number: ref.reference,
    bill_number: ref.billNumber,
    involved_staff_name: ref.staffName,
    involved_staff_id: ref.staffId,
    description,
    store_name: storeName,
    status: "open",
    priority: "normal",
    source: input.source,
    ...initialDeadlines("complaint", "normal"),
  };

  const result = await supabaseAdmin.from("complaints").insert(row).select("id, complaint_number, status, created_at").single();

  if (result.error || !result.data) {
    console.error("Create complaint error:", result.error);
    return { ok: false, error: "Unable to register the complaint. Please try again.", status: 500 };
  }
  const created = result.data;

  const announce = async () => {
    // Ask the staff member on the bill for their side of the story.
    if (ref.staffId) {
      await requestExplanation({
        ticketType: "complaint",
        ticketId: created.id,
        ticketNumber: created.complaint_number,
        staffId: ref.staffId,
        reason:
          complaintKind(category) === "staff"
            ? `Confidential — a customer complained about staff behaviour on bill ${ref.billNumber}: ${description.slice(0, 300)}`
            : `Customer complaint (${category}) about bill ${ref.billNumber}: ${description.slice(0, 300)}`,
        requestedBy: null,
      }).catch((error) => console.error("Auto explanation request failed:", error));
    }
    await announceNewTicket({
      type: "complaint",
      id: created.id,
      number: created.complaint_number,
      storeName,
      title: category,
      summary: `${category} · Customer: ${fullName} (${mobile}) · via ${SOURCE_LABELS[input.source]}`,
      details: [
        `Complaint: ${description}`,
        `Bill / warranty: ${ref.reference}`,
        ...(ref.staffName ? [`Staff on the bill: ${ref.staffName}`] : []),
      ],
      priority: "normal",
      customer: { name: fullName, mobile, email: email || null },
    }).catch((error) => console.error("New complaint alerts failed:", error));
  };

  return {
    ok: true,
    id: created.id,
    complaintNumber: created.complaint_number,
    status: created.status,
    createdAt: created.created_at,
    staffName: ref.staffName,
    storeName,
    announce,
  };
}
