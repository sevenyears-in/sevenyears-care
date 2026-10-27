import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cleanMobile, isValidMobile, one } from "@/lib/helpers";

// POST /api/track  { ticketNumber, mobileNumber }
// Works for service requests (SY-SRV-…) and complaints (SY-CMP-…).

type StoreRow = { store_name: string | null };

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ticketNumber = String(body.ticketNumber ?? "").trim().toUpperCase();
    const mobile = cleanMobile(body.mobileNumber);

    if (!ticketNumber) {
      return NextResponse.json({ error: "Enter your request number." }, { status: 400 });
    }
    if (!isValidMobile(mobile)) {
      return NextResponse.json(
        { error: "Enter a valid 10-digit Indian mobile number." },
        { status: 400 }
      );
    }

    const notFound = NextResponse.json(
      { error: "No request found for these details. Check the request number and mobile number." },
      { status: 404 }
    );

    if (ticketNumber.startsWith("SY-SRV-")) {
      const { data: row, error } = await supabaseAdmin
        .from("service_requests")
        .select(
          "id, request_number, contact_mobile, product_name, store_name, issue_type, description, service_mode, preferred_date, under_warranty, status, resolution_notes, created_at, updated_at, warranties ( warranty_number )"
        )
        .eq("request_number", ticketNumber)
        .maybeSingle();

      if (error) throw error;
      if (!row || row.contact_mobile !== mobile) return notFound;

      const warranty = one(row.warranties as unknown as { warranty_number: string } | { warranty_number: string }[] | null);

      return NextResponse.json({
        type: "service",
        ticketNumber: row.request_number,
        title: row.issue_type,
        description: row.description,
        status: row.status,
        notes: row.resolution_notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        details: [
          { label: "Product", value: row.product_name },
          { label: "Warranty Number", value: warranty?.warranty_number ?? null },
          {
            label: "Service Type",
            value: row.service_mode === "home_visit" ? "Home visit / pickup" : "Store visit",
          },
          { label: "Preferred Date", value: row.preferred_date, isDate: true },
          { label: "Store", value: row.store_name },
          {
            label: "Coverage",
            value: row.under_warranty ? "Under warranty" : "Out of warranty (chargeable)",
          },
        ],
        history: await loadHistory("service", row.id),
      });
    }

    if (ticketNumber.startsWith("SY-CMP-")) {
      const { data: row, error } = await supabaseAdmin
        .from("complaints")
        .select(
          "id, complaint_number, contact_mobile, category, description, reference_number, status, resolution_notes, created_at, updated_at, stores ( store_name )"
        )
        .eq("complaint_number", ticketNumber)
        .maybeSingle();

      if (error) throw error;
      if (!row || row.contact_mobile !== mobile) return notFound;

      const store = one(row.stores as unknown as StoreRow | StoreRow[] | null);

      return NextResponse.json({
        type: "complaint",
        ticketNumber: row.complaint_number,
        title: row.category,
        description: row.description,
        status: row.status,
        notes: row.resolution_notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        details: [
          { label: "Category", value: row.category },
          { label: "Store", value: store?.store_name ?? null },
          { label: "Reference", value: row.reference_number },
        ],
        history: await loadHistory("complaint", row.id),
      });
    }

    return notFound;
  } catch (error) {
    console.error("Track request error:", error);
    return NextResponse.json(
      { error: "Unable to fetch the request status. Please try again." },
      { status: 500 }
    );
  }
}

async function loadHistory(ticketType: "service" | "complaint", ticketId: string) {
  const { data, error } = await supabaseAdmin
    .from("ticket_status_history")
    .select("status, note, created_at")
    .eq("ticket_type", ticketType)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Status history error:", error);
    return [];
  }

  return (data ?? []).map((item) => ({
    status: item.status as string,
    note: (item.note as string | null) ?? null,
    createdAt: item.created_at as string,
  }));
}
