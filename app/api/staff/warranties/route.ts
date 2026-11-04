import { after, NextResponse } from "next/server";
import { feedbackLink } from "@/lib/feedback-token";
import { notifyCustomer, siteUrl } from "@/lib/notify";
import { supabaseAdmin } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth";
import { billPassword, ensureCustomerAccount } from "@/lib/customer-auth";
import { addMonths, cleanMobile, isISODate, isValidMobile, todayISO } from "@/lib/helpers";
import { extendedSettings } from "@/lib/extended-warranty";
import { buildWarrantyRows } from "@/lib/warranty-rules";
import { fetchBill, ZohoError } from "@/lib/zoho";

type IncomingItem = {
  key?: unknown;
  modelNumber?: unknown;
  serialNumber?: unknown;
  customerName?: unknown;
  customerMobile?: unknown;
  customerAddress?: unknown;
  alternateName?: unknown;
  alternateMobile?: unknown;
  extended?: unknown;
};

// The PDF certificate uses standard fonts, which only support English/Western letters.
const NON_ENGLISH = /[^\x20-\x7E\xA0-\xFF\r\n\t]/;

function warrantyNumber() {
  const year = todayISO().slice(0, 4);
  const random = Math.floor(100000 + Math.random() * 900000);
  return `SY-WAR-${year}-${random}`;
}

// ------------------------------------------------------------------
// POST /api/staff/warranties — save warranties for items on one bill
// Body: { billNumber, billDate, items: [{ key, modelNumber, serialNumber,
//         customerName, customerMobile, customerAddress, extended }] }
// ------------------------------------------------------------------

export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const billNumber = String(body.billNumber ?? "").trim();
    const billDate = String(body.billDate ?? "").trim();
    const items: IncomingItem[] = Array.isArray(body.items) ? body.items : [];

    if (!billNumber || !isISODate(billDate)) {
      return NextResponse.json({ error: "Bill number and date are required." }, { status: 400 });
    }
    if (items.length === 0) {
      return NextResponse.json({ error: "There are no items to register." }, { status: 400 });
    }

    // Re-read the bill from Zoho — never trust product details from the browser.
    const bill = await fetchBill(billNumber, billDate);
    const { rows } = await buildWarrantyRows(bill);
    const rowsByKey = new Map(rows.map((row) => [row.key, row]));

    // ---------------- Validate every item ----------------
    const errors: string[] = [];
    const seenKeys = new Set<string>();
    const seenSerials = new Set<string>();

    const clean = items.map((item, index) => {
      const label = `Row ${index + 1}`;
      const key = String(item.key ?? "");
      const row = rowsByKey.get(key);

      const modelNumber = String(item.modelNumber ?? "").trim();
      const serialNumber = String(item.serialNumber ?? "").trim();
      const customerName = String(item.customerName ?? "").trim();
      const customerMobile = cleanMobile(item.customerMobile);
      const customerAddress = String(item.customerAddress ?? "").trim();
      const extended = item.extended === true;
      const alternateName = String(item.alternateName ?? "").trim();
      const alternateMobile = cleanMobile(item.alternateMobile);

      if (!row) errors.push(`${label}: this item is not warranty-eligible on this bill.`);
      else if (row.existing)
        errors.push(`${label}: already registered as ${row.existing.warrantyNumber}.`);
      if (seenKeys.has(key)) errors.push(`${label}: duplicated.`);
      seenKeys.add(key);

      if (!modelNumber) errors.push(`${label}: model number is required.`);
      if (!serialNumber) errors.push(`${label}: serial number is required.`);
      if (!customerName) errors.push(`${label}: customer name is required.`);
      if (!isValidMobile(customerMobile)) errors.push(`${label}: enter a valid 10-digit mobile number.`);
      if (customerAddress.length < 5) errors.push(`${label}: customer address is required.`);
      if (alternateMobile && !isValidMobile(alternateMobile)) errors.push(`${label}: the alternate mobile number is not valid.`);
      if (alternateMobile && alternateMobile === customerMobile) errors.push(`${label}: the alternate mobile is the same as the customer's.`);
      if (alternateMobile && !alternateName) errors.push(`${label}: enter the product user's name.`);
      if ([modelNumber, serialNumber, customerName, customerAddress].some((v) => NON_ENGLISH.test(v)))
        errors.push(`${label}: please type details in English letters (needed for the PDF certificate).`);
      if (extended && row && !row.extendedAllowed)
        errors.push(`${label}: extended warranty is not available for ${row.categoryName}.`);

      const serialKey = serialNumber.toLowerCase();
      if (serialNumber && seenSerials.has(serialKey))
        errors.push(`${label}: serial number ${serialNumber} is entered twice.`);
      seenSerials.add(serialKey);

      return { row, modelNumber, serialNumber, customerName, customerMobile, customerAddress, extended, alternateName: alternateMobile ? alternateName : "", alternateMobile };
    });

    // Serial numbers already used on another warranty
    const serials = clean.map((c) => c.serialNumber).filter(Boolean);
    if (serials.length > 0) {
      const { data: used, error: usedError } = await supabaseAdmin
        .from("warranties")
        .select("serial_number, warranty_number")
        .in("serial_number", serials);

      if (usedError) throw usedError;
      for (const u of used ?? []) {
        errors.push(`Serial number ${u.serial_number} is already registered (${u.warranty_number}).`);
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    }

    // ---------------- Build records ----------------
    const startDate = bill.billDate;
    const ext = await extendedSettings(); // current price / months (Super Admin settings)
    const records = [];
    const usedNumbers = new Set<string>();

    for (const item of clean) {
      const row = item.row!;
      const standardExpiry = addMonths(startDate, row.standardMonths);
      const extendedStart = item.extended ? standardExpiry : null;
      const extendedExpiry = item.extended
        ? addMonths(standardExpiry, ext.months)
        : null;

      let number = warrantyNumber();
      for (let attempt = 0; attempt < 5; attempt++) {
        if (usedNumbers.has(number)) {
          number = warrantyNumber();
          continue;
        }
        const { data: clash } = await supabaseAdmin
          .from("warranties")
          .select("id")
          .eq("warranty_number", number)
          .maybeSingle();
        if (!clash) break;
        number = warrantyNumber();
      }
      usedNumbers.add(number);

      records.push({
        warranty_number: number,
        zoho_invoice_id: bill.invoiceId,
        bill_number: bill.billNumber,
        bill_date: bill.billDate,
        store_name: bill.storeName ?? auth.staff.storeName,
        zoho_line_item_id: row.lineItemId,
        zoho_item_id: row.itemId,
        unit_index: row.unitIndex,
        product_name: row.productName,
        sku: row.sku,
        category_name: row.categoryName,
        model_number: item.modelNumber,
        serial_number: item.serialNumber,
        customer_name: item.customerName,
        customer_mobile: item.customerMobile,
        customer_address: item.customerAddress,
        ...(item.alternateMobile ? { alternate_name: item.alternateName, alternate_mobile: item.alternateMobile } : {}),
        warranty_start_date: startDate,
        standard_warranty_expiry_date: standardExpiry,
        extended_warranty_purchased: item.extended,
        extended_warranty_fee: item.extended ? ext.price : 0,
        extended_warranty_start_date: extendedStart,
        extended_warranty_expiry_date: extendedExpiry,
        warranty_expiry_date: extendedExpiry ?? standardExpiry,
        status: "active",
        registered_by: auth.staff.id,
      });
    }

    const { data: created, error: insertError } = await supabaseAdmin
      .from("warranties")
      .insert(records)
      .select(
        "id, warranty_number, verification_token, product_name, serial_number, customer_name, warranty_expiry_date"
      );

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "One of these items was just registered by someone else. Fetch the bill again." },
          { status: 409 }
        );
      }
      throw insertError;
    }

    // Customer login: User ID = mobile, first password = last 4 digits of the bill number.
    const accounts: { mobile: string; name: string; created: boolean; password: string | null }[] = [];
    const seen = new Set<string>();
    // Login goes to the product's contact: the user when it's a gift, otherwise the buyer.
    const people = records.map((r) =>
      "alternate_mobile" in r && r.alternate_mobile
        ? { mobile: String(r.alternate_mobile), name: String(r.alternate_name ?? "") }
        : { mobile: String(r.customer_mobile), name: String(r.customer_name) }
    );
    for (const p of people) {
      const mobile = p.mobile;
      if (seen.has(mobile)) continue;
      seen.add(mobile);
      const result = await ensureCustomerAccount(mobile, p.name, bill.billNumber).catch(() => ({
        created: false,
      }));
      accounts.push({
        mobile,
        name: p.name,
        created: result.created,
        password: result.created ? billPassword(bill.billNumber) : null,
      });
    }

    // Gift: tell the product user their warranty is registered, with their login.
    const userMessages = new Map<string, { name: string; products: string[]; token: string }>();
    for (const r of records) {
      if (!("alternate_mobile" in r) || !r.alternate_mobile) continue;
      const c = (created ?? []).find((x) => x.warranty_number === r.warranty_number);
      const entry = userMessages.get(String(r.alternate_mobile)) ?? {
        name: String(r.alternate_name ?? ""),
        products: [] as string[],
        token: c?.verification_token ?? "",
      };
      entry.products.push(String(r.product_name));
      userMessages.set(String(r.alternate_mobile), entry);
    }
    for (const [mobile, u] of userMessages) {
      const login = accounts.find((a) => a.mobile === mobile);
      after(() =>
        notifyCustomer({
          name: u.name,
          mobile,
          ticketNumber: bill.billNumber,
          message: `Your Seven Years warranty is registered for: ${u.products.join(", ")}. For service, use your mobile number and bill no. ${bill.billNumber}.${
            login?.created && login.password
              ? ` My Account login — User ID: ${mobile}, password: ${login.password}.`
              : ""
          } Your warranty certificate:`,
          link: u.token ? `${siteUrl()}/warranty/${u.token}` : `${siteUrl()}/account`,
        }).catch((error) => console.error("Product user message failed:", error))
      );
    }

    // Sales feedback (one short form per bill) — sent once the items are handed over and registered.
    const first = (created ?? [])[0];
    if (first) {
      const firstRecord = records[0];
      after(() =>
        notifyCustomer({
          name: String(firstRecord.customer_name),
          mobile: String(firstRecord.customer_mobile),
          ticketNumber: bill.billNumber,
          message:
            "Thank you for shopping with Seven Years! Your warranty is registered. How was your shopping experience? Please rate us (1 minute):",
          link: feedbackLink("sales", first.id),
        }).catch((error) => console.error("Sales feedback message failed:", error))
      );
    }

    return NextResponse.json({ success: true, warranties: created ?? [], accounts }, { status: 201 });
  } catch (error) {
    if (error instanceof ZohoError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Save warranties error:", error);
    return NextResponse.json(
      { error: "Unable to save the warranties. Please try again." },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------------
// GET /api/staff/warranties?q=… — search (bill no., warranty no., mobile, serial)
// ------------------------------------------------------------------

export async function GET(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();

  let query = supabaseAdmin
    .from("warranties")
    .select(
      "id, warranty_number, verification_token, bill_number, bill_date, product_name, model_number, serial_number, customer_name, customer_mobile, warranty_expiry_date, extended_warranty_purchased, status, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (q) {
    // strip characters that have meaning in PostgREST filter syntax
    const safe = q.replace(/[,()*%]/g, " ").trim();
    const mobile = q.replace(/\D/g, "");
    const filters = [
      `warranty_number.ilike.%${safe}%`,
      `bill_number.ilike.%${safe}%`,
      `serial_number.ilike.%${safe}%`,
      `customer_name.ilike.%${safe}%`,
    ];
    if (mobile.length >= 4) filters.push(`customer_mobile.like.%${mobile}%`, `alternate_mobile.like.%${mobile}%`);
    query = query.or(filters.join(","));
  }

  const { data, error } = await query;

  if (error) {
    console.error("Search warranties error:", error);
    return NextResponse.json({ error: "Unable to load warranties." }, { status: 500 });
  }

  return NextResponse.json({ warranties: data ?? [] });
}
