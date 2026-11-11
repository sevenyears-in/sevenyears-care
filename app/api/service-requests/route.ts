import { after, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { defaultTechnicianFor } from "@/lib/store-technicians";
import { ensureCustomerAccountFromRequest, getCurrentCustomer } from "@/lib/customer-auth";
import { cleanMobile, generateTicketNumber, isISODate, isValidMobile, todayISO } from "@/lib/helpers";
import { SERVICE_ISSUE_TYPES, SERVICE_MODES } from "@/lib/site-config";
import { SAFETY_ISSUE_TYPES } from "@/lib/sla";
import { announceNewTicket, initialDeadlines } from "@/lib/tickets";
import { notifyCustomer } from "@/lib/notify";
import { attachPhotos, PHOTO_REQUIRED_ISSUES, MAX_PHOTOS } from "@/lib/service-photos";

// POST /api/service-requests
// Creates a service request against a registered warranty.
// Customer location (optional) is captured here.

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const customer = await getCurrentCustomer();

    // The person to contact (often not the buyer — baby products are gifts):
    // their name and mobile; the buyer is told separately.
    const mobile = cleanMobile(body.contactMobile ?? body.mobileNumber ?? customer?.mobile);
    const contactName = String(body.contactName ?? customer?.name ?? "").trim().slice(0, 120);
    const altName = String(body.altName ?? "").trim().slice(0, 120);
    const altMobile = cleanMobile(body.altMobile);
    const warrantyNumber = String(body.warrantyNumber ?? "").trim().toUpperCase();
    const ownerMobile = cleanMobile(body.ownerMobile);
    const photoPaths: string[] = Array.isArray(body.photos) ? body.photos.map(String).slice(0, MAX_PHOTOS) : [];
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
    if (!contactName) {
      return NextResponse.json({ error: "Enter the name of the person we should contact." }, { status: 400 });
    }
    if (altMobile && !isValidMobile(altMobile)) {
      return NextResponse.json({ error: "The alternate mobile number is not valid." }, { status: 400 });
    }
    if (!isValidMobile(mobile)) {
      return NextResponse.json(
        { error: "Enter a valid 10-digit Indian mobile number." },
        { status: 400 }
      );
    }
    if (!warrantyNumber) {
      return NextResponse.json({ error: "Enter the invoice or warranty number and choose the product." }, { status: 400 });
    }
    if (!SERVICE_ISSUE_TYPES.includes(issueType)) {
      return NextResponse.json({ error: "Please choose the type of problem." }, { status: 400 });
    }
    if (PHOTO_REQUIRED_ISSUES.includes(issueType) && photoPaths.length < MAX_PHOTOS) {
      return NextResponse.json({ error: `Please add ${MAX_PHOTOS} photos of the product from different angles.` }, { status: 400 });
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
        "id, warranty_number, warranty_expiry_date, status, customer_name, customer_mobile, customer_address, alternate_name, alternate_mobile, product_name, store_name, service_coverage"
      )
      .eq("warranty_number", warrantyNumber)
      .maybeSingle();

    if (warrantyError) throw warrantyError;

    // The invoice or warranty number is the proof of purchase — the requester's mobile can be anyone's.
    if (!warranty) {
      return NextResponse.json(
        {
          error: "We couldn't find this warranty. Please check the invoice or warranty number and try again.",
        },
        { status: 404 }
      );
    }

    // Proof: the buyer's or the product user's mobile (or logged in as one of them).
    const owners = [warranty.customer_mobile, warranty.alternate_mobile].filter(Boolean);
    if (![ownerMobile, mobile, customer?.mobile].some((m) => m && owners.includes(m))) {
      return NextResponse.json(
        {
          error:
            "These details don't match our records. Please check and try again, or contact your nearest Seven Years store.",
        },
        { status: 403 }
      );
    }

    // In-Store warranty: a home visit / pickup is a paid service — the customer must agree to the charge.
    const paidHomeVisit = warranty.service_coverage === "in_store" && serviceMode === "home_visit";
    if (paidHomeVisit && body.homeVisitChargeAgreed !== true) {
      return NextResponse.json(
        { error: "This warranty is In-Store service. Please agree to the home visit / pickup charge, or choose to bring it to the store." },
        { status: 400 }
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

    const today = todayISO();
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
        contact_name: contactName,
        contact_mobile: mobile,
        alternate_name: altName || null,
        alternate_mobile: altMobile || null,
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

    // Photos: move from the temporary folder to this request.
    const photos = photoPaths.length ? await attachPhotos(created.id, photoPaths).catch(() => [] as string[]) : [];

    // In-Store warranty with a home visit: note on the ticket that the visit / pickup is chargeable.
    if (paidHomeVisit) {
      await supabaseAdmin
        .from("ticket_status_history")
        .insert({
          ticket_type: "service",
          ticket_id: created.id,
          status: "open",
          note: "In-Store warranty: the home visit / pickup is a paid service. The customer agreed to the visit / pickup charge; the warranty repair stays free.",
          visibility: "customer",
          action: "note",
          actor_name: "System",
        })
        .then(({ error }) => error && console.error("Paid home visit note failed:", error));
    }

    // Stores without a separate technician (e.g. the Service Head does it): give the job straight to them.
    const defaultTech = await defaultTechnicianFor(warranty.store_name ?? null).catch(() => null);
    if (defaultTech) {
      const { error: assignError } = await supabaseAdmin
        .from("service_requests")
        .update({ assigned_technician_id: defaultTech.id })
        .eq("id", created.id);
      if (!assignError) {
        await supabaseAdmin.from("ticket_status_history").insert({
          ticket_type: "service",
          ticket_id: created.id,
          status: "open",
          note: `Assigned automatically to ${defaultTech.fullName} (technician for ${warranty.store_name}).`,
          visibility: "internal",
          action: "assign",
          actor_name: "System",
        });
      }
    }

    // Alert the store manager, technicians and service head; confirm to the customer.
    after(() =>
      announceNewTicket({
        type: "service",
        id: created.id,
        number: created.request_number,
        storeName: warranty.store_name ?? null,
        title: issueType,
        summary: `${warranty.product_name} — ${issueType} · Contact: ${contactName} (${mobile})${
          warranty.customer_mobile !== mobile ? ` · Bought by ${warranty.customer_name} (${warranty.customer_mobile})` : ""
        }${
          warranty.alternate_mobile && warranty.alternate_mobile !== mobile
            ? ` · User ${warranty.alternate_name ?? ""} (${warranty.alternate_mobile})`
            : ""
        }`,
        details: [
          `Problem: ${description}`,
          paidHomeVisit
            ? "Customer asked for a home visit / pickup — PAID: In-Store warranty, customer agreed to the visit / pickup charge."
            : serviceMode === "home_visit"
              ? "Customer asked for a home visit / pickup."
              : "Customer will bring it to the store.",
          ...(photos.length ? [`${photos.length} photo${photos.length > 1 ? "s" : ""} attached.`] : []),
          underWarranty ? "Under warranty." : "Out of warranty (chargeable).",
          ...(priority === "safety" ? ["SAFETY: ask the customer to stop using the product until it is checked."] : []),
        ],
        priority,
        customer: { name: contactName, mobile },
      }).catch((error) => console.error("New service request alerts failed:", error))
    );

    // The product's contact (the user if one was given, else the buyer) gets a copy when someone else raised it.
    const ownerContact = warranty.alternate_mobile
      ? { name: String(warranty.alternate_name ?? ""), mobile: String(warranty.alternate_mobile) }
      : { name: warranty.customer_name, mobile: warranty.customer_mobile };
    if (ownerContact.mobile && ownerContact.mobile !== mobile) {
      after(() =>
        notifyCustomer({
          name: ownerContact.name,
          mobile: ownerContact.mobile,
          ticketNumber: created.request_number,
          message: `A service request was raised for your ${warranty.product_name} by ${contactName}. Our team will contact them directly.`,
        }).catch((error) => console.error("Buyer copy failed:", error))
      );
    }

    // First request from this mobile: give them a My Account login.
    const account = customer && customer.mobile === mobile
      ? { created: false }
      : await ensureCustomerAccountFromRequest(mobile, contactName);

    return NextResponse.json(
      {
        success: true,
        account: account.created ? { created: true } : null,
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
