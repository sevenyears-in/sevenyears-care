import { after, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cleanMobile, generateTicketNumber, isValidMobile } from "@/lib/helpers";
import { COMPLAINT_CATEGORIES } from "@/lib/site-config";
import { announceNewTicket, initialDeadlines } from "@/lib/tickets";

// POST /api/complaints — anyone can raise a complaint (no warranty needed).

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const fullName = String(body.fullName ?? "").trim();
    const mobile = cleanMobile(body.mobileNumber);
    const email = String(body.email ?? "").trim();
    const storeId = body.storeId ? String(body.storeId) : null;
    const category = String(body.category ?? "").trim();
    const reference = String(body.reference ?? "").trim();
    const description = String(body.description ?? "").trim();

    if (!fullName) {
      return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
    }
    if (!isValidMobile(mobile)) {
      return NextResponse.json(
        { error: "Enter a valid 10-digit Indian mobile number." },
        { status: 400 }
      );
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Email address is not valid." }, { status: 400 });
    }
    if (!COMPLAINT_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: "Please choose what the complaint is about." },
        { status: 400 }
      );
    }
    if (description.length < 10) {
      return NextResponse.json(
        { error: "Please describe the issue in a little more detail." },
        { status: 400 }
      );
    }

    let storeName: string | null = null;
    if (storeId) {
      const { data: store } = await supabaseAdmin
        .from("stores")
        .select("id, store_name")
        .eq("id", storeId)
        .eq("is_active", true)
        .maybeSingle();

      if (!store) {
        return NextResponse.json({ error: "Invalid Seven Years location." }, { status: 400 });
      }
      storeName = store.store_name ?? null;
    }

    // Link to a warranty when the reference (warranty or bill number) belongs to this mobile.
    let warrantyId: string | null = null;
    if (reference) {
      const ref = reference.toUpperCase();
      const { data: owned } = await supabaseAdmin
        .from("warranties")
        .select("id, warranty_number, bill_number, store_name")
        .eq("customer_mobile", mobile);

      const match = (owned ?? []).find(
        (w) =>
          String(w.warranty_number).toUpperCase() === ref ||
          String(w.bill_number).toUpperCase() === ref
      );
      warrantyId = match?.id ?? null;
      // No store chosen? Use the store the product was bought from.
      if (!storeName && match?.store_name) storeName = match.store_name;
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

    const { data: created, error: insertError } = await supabaseAdmin
      .from("complaints")
      .insert({
        complaint_number: complaintNumber,
        contact_name: fullName,
        contact_mobile: mobile,
        contact_email: email || null,
        store_id: storeId,
        warranty_id: warrantyId,
        category,
        reference_number: reference || null,
        description,
        store_name: storeName,
        status: "open",
        priority: "normal",
        ...initialDeadlines("complaint", "normal"),
      })
      .select("id, complaint_number, status, created_at")
      .single();

    if (insertError) throw insertError;

    // Alert the store manager, HR Head and Operations Manager; confirm to the customer.
    after(() =>
      announceNewTicket({
        type: "complaint",
        id: created.id,
        number: created.complaint_number,
        storeName,
        title: category,
        summary: `${category} · Customer: ${fullName} (${mobile})`,
        details: [`Complaint: ${description}`, ...(reference ? [`Reference: ${reference}`] : [])],
        priority: "normal",
        customer: { name: fullName, mobile, email: email || null },
      }).catch((error) => console.error("New complaint alerts failed:", error))
    );

    return NextResponse.json(
      {
        success: true,
        complaint: {
          complaint_number: created.complaint_number,
          status: created.status,
          created_at: created.created_at,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Complaint error:", error);
    return NextResponse.json(
      { error: "Unable to register the complaint. Please try again." },
      { status: 500 }
    );
  }
}
