import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

function generateWarrantyNumber() {
  const year = new Date().getFullYear();
  const random = Math.floor(100000 + Math.random() * 900000);

  return `SY-WAR-${year}-${random}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
  fullName,
  mobileNumber,
  email,
  invoiceNumber,
  purchaseDate,
  storeId,
  productId,
  serialNumber,
  latitude,
  longitude,
  locationAccuracy,
  extendedWarrantyPurchased,
} = body;

    // -----------------------------------------------------
    // 1. Basic validation
    // -----------------------------------------------------

    if (!fullName?.trim()) {
      return NextResponse.json(
        { error: "Customer name is required." },
        { status: 400 }
      );
    }

    const cleanMobile = String(mobileNumber || "").replace(/\D/g, "");

    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      return NextResponse.json(
        { error: "Enter a valid 10-digit Indian mobile number." },
        { status: 400 }
      );
    }

    if (!invoiceNumber?.trim()) {
      return NextResponse.json(
        { error: "Invoice number is required." },
        { status: 400 }
      );
    }

    if (!purchaseDate) {
      return NextResponse.json(
        { error: "Purchase date is required." },
        { status: 400 }
      );
    }

    if (!storeId) {
      return NextResponse.json(
        { error: "Please select the purchase location." },
        { status: 400 }
      );
    }

    if (!productId) {
      return NextResponse.json(
        { error: "Please select the product." },
        { status: 400 }
      );
    }

    // -----------------------------------------------------
    // 2. Verify store
    // -----------------------------------------------------

    const { data: store, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .eq("is_active", true)
      .single();

    if (storeError || !store) {
      return NextResponse.json(
        { error: "Invalid Seven Years location." },
        { status: 400 }
      );
    }

    // -----------------------------------------------------
    // 3. Get product information from database
    // -----------------------------------------------------

    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select(`
        id,
        sku,
        product_name,
        model_number,
        serial_number_required,
        default_warranty_months,
        brand_id,
        brands (
          brand_name
        )
      `)
      .eq("id", productId)
      .eq("is_active", true)
      .single();

    if (productError || !product) {
      return NextResponse.json(
        { error: "Invalid product." },
        { status: 400 }
      );
    }

    if (product.serial_number_required && !serialNumber?.trim()) {
      return NextResponse.json(
        { error: "Serial number is required for this product." },
        { status: 400 }
      );
    }

    // -----------------------------------------------------
    // 4. Create or update customer
    // -----------------------------------------------------

    const customerPayload = {
      full_name: fullName.trim(),
      mobile_country_code: "+91",
      mobile_number: cleanMobile,
      email: email?.trim() || null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      location_accuracy_meters: locationAccuracy ?? null,
      location_captured_at:
        latitude != null && longitude != null
          ? new Date().toISOString()
          : null,
    };

    const { data: existingCustomer, error: customerLookupError } =
      await supabaseAdmin
        .from("customers")
        .select("id")
        .eq("mobile_country_code", "+91")
        .eq("mobile_number", cleanMobile)
        .maybeSingle();

    if (customerLookupError) {
      throw customerLookupError;
    }

    let customerId: string;

    if (existingCustomer) {
      const { data: updatedCustomer, error: updateCustomerError } =
        await supabaseAdmin
          .from("customers")
          .update(customerPayload)
          .eq("id", existingCustomer.id)
          .select("id")
          .single();

      if (updateCustomerError) {
        throw updateCustomerError;
      }

      customerId = updatedCustomer.id;
    } else {
      const { data: newCustomer, error: customerError } =
        await supabaseAdmin
          .from("customers")
          .insert(customerPayload)
          .select("id")
          .single();

      if (customerError) {
        throw customerError;
      }

      customerId = newCustomer.id;
    }

    // -----------------------------------------------------
    // 5. Create purchase / invoice
    // -----------------------------------------------------

    let purchase;

const { data: existingPurchase, error: existingPurchaseError } =
  await supabaseAdmin
    .from("purchases")
    .select("id, customer_id, invoice_date")
    .eq("store_id", storeId)
    .eq("invoice_number", invoiceNumber.trim())
    .maybeSingle();

if (existingPurchaseError) {
  throw existingPurchaseError;
}

if (existingPurchase) {
  purchase = existingPurchase;
} else {
  const { data: newPurchase, error: purchaseError } =
    await supabaseAdmin
      .from("purchases")
      .insert({
        customer_id: customerId,
        store_id: storeId,
        invoice_number: invoiceNumber.trim(),
        invoice_date: purchaseDate,
        purchase_source: "store",
      })
      .select("id, customer_id, invoice_date")
      .single();

  if (purchaseError) {
    throw purchaseError;
  }

  purchase = newPurchase;
}

  

    // -----------------------------------------------------
    // 6. Create purchase item
    // -----------------------------------------------------

    const brandRelation = Array.isArray(product.brands)
      ? product.brands[0]
      : product.brands;

    const { data: purchaseItem, error: purchaseItemError } =
      await supabaseAdmin
        .from("purchase_items")
        .insert({
          purchase_id: purchase.id,
          product_id: product.id,
          product_name_snapshot: product.product_name,
          sku_snapshot: product.sku,
          brand_name_snapshot: brandRelation?.brand_name ?? null,
          model_number_snapshot: product.model_number,
          quantity: 1,
          serial_number: serialNumber?.trim() || null,
        })
        .select("id")
        .single();

    if (purchaseItemError) {
      throw purchaseItemError;
    }

    // -----------------------------------------------------
    // 7. Calculate warranty period
    // -----------------------------------------------------

    const standardWarrantyStartDate = new Date(
  `${purchaseDate}T00:00:00`
);

const standardWarrantyExpiryDate = new Date(
  standardWarrantyStartDate
);

standardWarrantyExpiryDate.setMonth(
  standardWarrantyExpiryDate.getMonth() + 6
);

const extendedPurchased =
  extendedWarrantyPurchased === true;

let extendedWarrantyStartDate: Date | null = null;
let extendedWarrantyExpiryDate: Date | null = null;

if (extendedPurchased) {
  extendedWarrantyStartDate = new Date(
    standardWarrantyExpiryDate
  );

  extendedWarrantyExpiryDate = new Date(
    extendedWarrantyStartDate
  );

  extendedWarrantyExpiryDate.setMonth(
    extendedWarrantyExpiryDate.getMonth() + 6
  );
}

const formatDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const warrantyStartDate = formatDate(
  standardWarrantyStartDate
);

const standardWarrantyExpiry =
  formatDate(standardWarrantyExpiryDate);

const extendedWarrantyStart =
  extendedWarrantyStartDate
    ? formatDate(extendedWarrantyStartDate)
    : null;

const extendedWarrantyExpiry =
  extendedWarrantyExpiryDate
    ? formatDate(extendedWarrantyExpiryDate)
    : null;

const finalWarrantyExpiryDate =
  extendedWarrantyExpiry ??
  standardWarrantyExpiry;



    // -----------------------------------------------------
    // 8. Generate warranty number
    // -----------------------------------------------------

    let warrantyNumber = generateWarrantyNumber();

    let attempts = 0;

    while (attempts < 5) {
      const { data: existingWarranty } = await supabaseAdmin
        .from("warranty_registrations")
        .select("id")
        .eq("warranty_number", warrantyNumber)
        .maybeSingle();

      if (!existingWarranty) break;

      warrantyNumber = generateWarrantyNumber();
      attempts++;
    }

    // -----------------------------------------------------
    // 9. Create warranty registration
    // -----------------------------------------------------

  const { data: warranty, error: warrantyError } =
  await supabaseAdmin
    .from("warranty_registrations")
    .insert({
      warranty_number: warrantyNumber,

      customer_id: customerId,

      purchase_id: purchase.id,

      purchase_item_id: purchaseItem.id,

      product_id: product.id,

      store_id: storeId,

      serial_number: serialNumber?.trim() || null,

      warranty_start_date: warrantyStartDate,

      standard_warranty_start_date: warrantyStartDate,

      standard_warranty_expiry_date:
        standardWarrantyExpiry,

      warranty_expiry_date:
        finalWarrantyExpiryDate,

      extended_warranty_purchased:
        extendedPurchased,

      extended_warranty_fee:
        extendedPurchased ? 1200 : 0,

      extended_warranty_purchase_date:
        extendedPurchased
          ? new Date().toISOString().split("T")[0]
          : null,

      extended_warranty_start_date:
        extendedWarrantyStart,

      extended_warranty_expiry_date:
        extendedWarrantyExpiry,

      warranty_terms_version:
        "SY-WAR-2026-01",

      registration_source: "customer",

      customer_latitude: latitude ?? null,

      customer_longitude: longitude ?? null,

      location_accuracy_meters:
        locationAccuracy ?? null,

      location_captured_at:
        latitude != null && longitude != null
          ? new Date().toISOString()
          : null,

      status: "active",
    })
    .select(`
      id,
      warranty_number,
      warranty_start_date,
      warranty_expiry_date,
      standard_warranty_start_date,
      standard_warranty_expiry_date,
      extended_warranty_purchased,
      extended_warranty_fee,
      extended_warranty_start_date,
      extended_warranty_expiry_date,
      status,
      verification_token
    `)
    .single();

    if (warrantyError) {
  console.error("Warranty registration error:", warrantyError);

  return NextResponse.json(
    {
      error: "Unable to register warranty.",
      details: warrantyError.message,
    },
    { status: 500 }
  );
}

    // -----------------------------------------------------
    // 10. Return result
    // -----------------------------------------------------

    return NextResponse.json(
      {
        success: true,
        message: "Warranty registered successfully.",
        warranty,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Warranty registration error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to register warranty. Please try again.",
      },
      { status: 500 }
    );
  }
}