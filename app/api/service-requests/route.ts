import { after, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cleanMobile, generateTicketNumber, isISODate, isValidMobile } from "@/lib/helpers";
import { SERVICE_ISSUE_TYPES, SERVICE_MODES } from "@/lib/site-config";
import { SAFETY_ISSUE_TYPES } from "@/lib/sla";
import { announceNewTicket, initialDeadlines } from "@/lib/tickets";

// POST /api/service-requests
// Creates a service request against a registered warranty.
// Customer location (optional) is captured here.

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const mobile = cleanMobile(body.mobileNumber);
    const warrantyNumber = String(body.warrantyNumber ?? "").trim().toUpperCase();
    const issueType = String(body.issueType ?? "").trim();
    const description = String(body.description ?? "").trim();
    const serviceMode = String(body.serviceMode ?? "store_visit");
    const preferredDate = body.preferredDate ? String(body.preferredDate) : null;
    const address = String(body.address ?? "").trim();
    const latitude = typeof body.latitude === "number" ? body.latitude : null;
    const longitude = typeof body.longitude === "number" ? body.longitude : null;
    const locationAccuracy =
      typeof body.locationAccuracy === "number" ? body.locationAccuracy : null;

    // ---------------- Validation ----------------
    if (!isValidMobile(mobile)) {
      return NextResponse.json(
        { error: "Enter a valid 10-digit Indian mobile number." },
        { status: 400 }
      );
    }
    if (!warrantyNumber) {
      return NextResponse.json({ error: "Enter your warranty number." }, { status: 400 });
    }
    if (!SERVICE_ISSUE_TYPES.includes(issueType)) {
      return NextResponse.json({ error: "Please choose the type of problem." }, { status: 400 });
    }
    if (description.length < 10) {
      return NextResponse.json(
        { error: "Please describe the problem in a little more detail." },
        { status: 400 }
      );
    }
    if (!SERVICE_MODES.some((mode) => mode.value === serviceMode)) {
      return NextResponse.json(
        { error: "Please choose how you would like the service." },
        { status: 400 }
      );
    }
    if (preferredDate && !isISODate(preferredDate)) {
      return NextResponse.json({ error: "Preferred date is not valid." }, { status: 400 });
    }

    // ---------------- Find the warranty ----------------
    const { data: warranty, error: warrantyError } = await supabaseAdmin
      .from("warranties")
      .select(
        "id, warranty_number, warranty_expiry_date, status, customer_name, customer_mobile, customer_address, product_name, store_name"
      )
      .eq("warranty_number", warrantyNumber)
      .maybeSingle();

    if (warrantyError) throw warrantyError;

    if (!warranty || warranty.customer_mobile !== mobile) {
      return NextResponse.json(
        {
          error:
            "This warranty number doesn't match the mobile number. Please check both and try again.",
        },
        { status: 404 }
      );
    }

    if (warranty.status !== "active") {
      return NextResponse.json(
        { error: "This warranty is not active. Please raise a complaint or contact the store." },
        { status: 400 }
      );
    }

    // ---------------- Only one open request per warranty ----------------
    const { data: openRequest } = await supabaseAdmin
      .from("service_requests")
      .select("request_number")
      .eq("warranty_id", warranty.id)
      .in("status", ["open", "acknowledged", "assigned", "in_progress", "awaiting_parts", "awaiting_approval"])
      .limit(1)
      .maybeSingle();

    if (openRequest) {
      return NextResponse.json(
        {
          error: `You already have an open service request (${openRequest.request_number}) for this product. Use Track Request to check its status.`,
        },
        { status: 409 }
      );
    }

    const today = new Date().toISOString().split("T")[0];
    const underWarranty = warranty.warranty_expiry_date >= today;

    // ---------------- Unique ticket number ----------------
    let requestNumber = generateTicketNumber("SRV");
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: clash } = await supabaseAdmin
        .from("service_requests")
        .select("id")
        .eq("request_number", requestNumber)
        .maybeSingle();
      if (!clash) break;
      requestNumber = generateTicketNumber("SRV");
    }

    // Brake / frame problems on baby gear are safety issues: top priority.
    const priority = SAFETY_ISSUE_TYPES.includes(issueType) ? "safety" : "normal";

    // ---------------- Create ----------------
    const { data: created, error: insertError } = await supabaseAdmin
      .from("service_requests")
      .insert({
        request_number: requestNumber,
        warranty_id: warranty.id,
        contact_name: warranty.customer_name,
        contact_mobile: mobile,
        product_name: warranty.product_name,
        store_name: warranty.store_name,
        issue_type: issueType,
        description,
        service_mode: serviceMode,
        preferred_date: preferredDate,
        address: address || (serviceMode === "home_visit" ? warranty.customer_address : null),
        under_warranty: underWarranty,
        latitude,
        longitude,
        location_accuracy_meters: locationAccuracy,
        status: "open",
        priority,
        ...initialDeadlines("service", priority),
      })
      .select("id, request_number, status, under_warranty, created_at")
      .single();

    if (insertError) throw insertError;

    // Alert the store manager, technicians and service head; confirm to the customer.
    after(() =>
      announceNewTicket({
        type: "service",
        id: created.id,
        number: created.request_number,
        storeName: warranty.store_name ?? null,
        title: issueType,
        summary: `${warranty.product_name} — ${issueType} · Customer: ${warranty.customer_name} (${mobile})`,
        details: [
          `Problem: ${description}`,
          serviceMode === "home_visit" ? "Customer asked for a home visit / pickup." : "Customer will bring it to the store.",
          underWarranty ? "Under warranty." : "Out of warranty (chargeable).",
          ...(priority === "safety" ? ["SAFETY: ask the customer to stop using the product until it is checked."] : []),
        ],
        priority,
        customer: { name: warranty.customer_name, mobile },
      }).catch((error) => console.error("New service request alerts failed:", error))
    );

    return NextResponse.json(
      {
        success: true,
        request: {
          request_number: created.request_number,
          status: created.status,
          under_warranty: created.under_warranty,
          created_at: created.created_at,
          priority,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Service request error:", error);
    return NextResponse.json(
      { error: "Unable to create the service request. Please try again." },
      { status: 500 }
    );
  }
}
