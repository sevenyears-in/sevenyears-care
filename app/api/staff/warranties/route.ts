import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth";
import { addMonths, cleanMobile, isISODate, isValidMobile } from "@/lib/helpers";
import { EXTENDED_WARRANTY } from "@/lib/site-config";
import { buildWarrantyRows } from "@/lib/warranty-rules";
import { fetchBill, ZohoError } from "@/lib/zoho";

type IncomingItem = {
  key?: unknown;
  modelNumber?: unknown;
  serialNumber?: unknown;
  customerName?: unknown;
  customerMobile?: unknown;
  customerAddress?: unknown;
  extended?: unknown;
};

// The PDF certificate uses standard fonts, which only support English/Western letters.
const NON_ENGLISH = /[^\x20-\x7E\xA0-\xFF\r\n\t]/;

function warrantyNumber() {
  const year = new Date().getFullYear();
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
      if ([modelNumber, serialNumber, customerName, customerAddress].some((v) => NON_ENGLISH.test(v)))
        errors.push(`${label}: please type details in English letters (needed for the PDF certificate).`);
      if (extended && row && !row.extendedAllowed)
        errors.push(`${label}: extended warranty is not available for ${row.categoryName}.`);

      const serialKey = serialNumber.toLowerCase();
      if (serialNumber && seenSerials.has(serialKey))
        errors.push(`${label}: serial number ${serialNumber} is entered twice.`);
      seenSerials.add(serialKey);

      return { row, modelNumber, serialNumber, customerName, customerMobile, customerAddress, extended };
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
    const records = [];
    const usedNumbers = new Set<string>();

    for (const item of clean) {
      const row = item.row!;
      const standardExpiry = addMonths(startDate, row.standardMonths);
      const extendedStart = item.extended ? standardExpiry : null;
      const extendedExpiry = item.extended
        ? addMonths(standardExpiry, EXTENDED_WARRANTY.months)
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
        warranty_start_date: startDate,
        standard_warranty_expiry_date: standardExpiry,
        extended_warranty_purchased: item.extended,
        extended_warranty_fee: item.extended ? EXTENDED_WARRANTY.fee : 0,
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

    return NextResponse.json({ success: true, warranties: created ?? [] }, { status: 201 });
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
    if (mobile.length >= 4) filters.push(`customer_mobile.like.%${mobile}%`);
    query = query.or(filters.join(","));
  }

  const { data, error } = await query;

  if (error) {
    console.error("Search warranties error:", error);
    return NextResponse.json({ error: "Unable to load warranties." }, { status: 500 });
  }

  return NextResponse.json({ warranties: data ?? [] });
}
