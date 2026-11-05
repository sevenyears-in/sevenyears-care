import { after, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ensureCustomerAccountFromRequest, getCurrentCustomer } from "@/lib/customer-auth";
import { cleanMobile, generateTicketNumber, isISODate, isValidMobile, todayISO } from "@/lib/helpers";
import { PAID_PRODUCT_TYPES, SERVICE_ISSUE_TYPES, SERVICE_MODES } from "@/lib/site-config";
import { SAFETY_ISSUE_TYPES } from "@/lib/sla";
import { getStores } from "@/lib/stores";
import { announceNewTicket, initialDeadlines } from "@/lib/tickets";
import { attachPhotos, MAX_PHOTOS } from "@/lib/service-photos";

// POST /api/service-requests/paid — chargeable service for a product bought
// elsewhere, or one without a Seven Years warranty. No warranty needed.

const clip = (v: unknown, n = 120) => String(v ?? "").trim().slice(0, n);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const customer = await getCurrentCustomer();

    const contactName = clip(body.contactName);
    const mobile = cleanMobile(body.contactMobile ?? customer?.mobile);
    const altName = clip(body.altName);
    const altMobile = cleanMobile(body.altMobile);
    const productType = clip(body.productType, 60);
    const brand = clip(body.brand, 80);
    const model = clip(body.model, 80);
    const purchasedFrom = clip(body.purchasedFrom, 120);
    const issueType = clip(body.issueType, 60);
    const description = clip(body.description, 1500);
    const serviceMode = clip(body.serviceMode, 20) || "store_visit";
    const preferredDate = body.preferredDate ? String(body.preferredDate) : null;
    const address = clip(body.address, 500);
    const storeName = clip(body.storeName, 120);
    const photoPaths: string[] = Array.isArray(body.photos) ? body.photos.map(String).slice(0, MAX_PHOTOS) : [];
    const latitude = typeof body.latitude === "number" ? body.latitude : null;
    const longitude = typeof body.longitude === "number" ? body.longitude : null;
    const locationAccuracy = typeof body.locationAccuracy === "number" ? body.locationAccuracy : null;

    const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
    if (!contactName) return bad("Enter your name.");
    if (!isValidMobile(mobile)) return bad("Enter a valid 10-digit mobile number.");
    if (altMobile && !isValidMobile(altMobile)) return bad("The alternate mobile number is not valid.");
    if (!PAID_PRODUCT_TYPES.includes(productType)) return bad("Choose the type of product.");
    if (!brand) return bad("Enter the brand of the product.");
    if (!SERVICE_ISSUE_TYPES.includes(issueType)) return bad("Choose the type of problem.");
    if (description.length < 10) return bad("Please describe the problem in a little more detail.");
    if (!SERVICE_MODES.some((m) => m.value === serviceMode)) return bad("Choose how you would like the service.");
    if (serviceMode === "home_visit" && address.length < 10) return bad("Enter the address for the home visit / pickup.");
    if (preferredDate && !isISODate(preferredDate)) return bad("Preferred date is not valid.");
    if (body.agreed !== true) return bad("Please confirm that you understand the service is chargeable.");

    const { stores } = await getStores();
    const store = stores.find((s) => s.name.toLowerCase() === storeName.toLowerCase());
    if (!store) return bad("Choose the store you would like to visit.");

    // Only one open paid request per mobile + product
    const { data: open } = await supabaseAdmin
      .from("service_requests")
      .select("request_number")
      .eq("paid", true)
      .eq("contact_mobile", mobile)
      .ilike("brand", brand)
      .in("status", ["open", "acknowledged", "assigned", "in_progress", "awaiting_parts", "awaiting_approval"])
      .limit(1)
      .maybeSingle();
    if (open) {
      return NextResponse.json(
        { error: `You already have an open service request (${open.request_number}) for this product. Use Track Request to check its status.` },
        { status: 409 }
      );
    }

    let requestNumber = generateTicketNumber("SRV");
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: clash } = await supabaseAdmin.from("service_requests").select("id").eq("request_number", requestNumber).maybeSingle();
      if (!clash) break;
      requestNumber = generateTicketNumber("SRV");
    }

    const priority = SAFETY_ISSUE_TYPES.includes(issueType) ? "safety" : "normal";
    const productName = [brand, productType, model].filter(Boolean).join(" · ");

    const { data: created, error } = await supabaseAdmin
      .from("service_requests")
      .insert({
        request_number: requestNumber,
        warranty_id: null,
        paid: true,
        brand,
        model_number: model || null,
        purchased_from: purchasedFrom || null,
        contact_name: contactName,
        contact_mobile: mobile,
        alternate_name: altName || null,
        alternate_mobile: altMobile || null,
        product_name: productName,
        store_name: store.name,
        issue_type: issueType,
        description,
        service_mode: serviceMode,
        preferred_date: preferredDate,
        address: address || null,
        under_warranty: false,
        latitude,
        longitude,
        location_accuracy_meters: locationAccuracy,
        status: "open",
        priority,
        ...initialDeadlines("service", priority),
      })
      .select("id, request_number, status, created_at")
      .single();
    if (error) throw error;

    const photos = photoPaths.length ? await attachPhotos(created.id, photoPaths).catch(() => [] as string[]) : [];

    after(() =>
      announceNewTicket({
        type: "service",
        id: created.id,
        number: created.request_number,
        storeName: store.name,
        title: issueType,
        summary: `PAID SERVICE — ${productName} — ${issueType} · ${contactName} (${mobile})`,
        details: [
          `Problem: ${description}`,
          `Bought from: ${purchasedFrom || "not given"}`,
          serviceMode === "home_visit" ? "Customer asked for a home visit / pickup (chargeable)." : "Customer will bring it to the store.",
          "Chargeable: inspection charge applies; send the repair quote for the customer's approval before starting work.",
          ...(photos.length ? [`${photos.length} photo${photos.length > 1 ? "s" : ""} attached.`] : []),
        ],
        priority,
        customer: { name: contactName, mobile },
      }).catch((e) => console.error("Paid service alerts failed:", e))
    );

    const account = customer && customer.mobile === mobile ? { created: false } : await ensureCustomerAccountFromRequest(mobile, contactName);

    return NextResponse.json(
      {
        success: true,
        account: account.created ? { created: true } : null,
        request: { request_number: created.request_number, status: created.status, under_warranty: false, created_at: created.created_at, priority, paid: true },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Paid service request error:", error);
    return NextResponse.json({ error: "Unable to create the service request. Please try again." }, { status: 500 });
  }
}
