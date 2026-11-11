import { deleteWarranty } from "@/lib/admin-delete";
import { warrantyEditLevel } from "@/lib/warranty-edit";
import { isISODate } from "@/lib/helpers";
import { loadActiveCategories } from "@/lib/warranty-rules";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
const NOT_RECORDED = "Not recorded";
import { after } from "next/server";
import { billPassword, ensureCustomerAccount } from "@/lib/customer-auth";
import { cleanMobile, isValidMobile } from "@/lib/helpers";
import { notifyCustomer, siteUrl } from "@/lib/notify";
import { isServiceCoverage } from "@/lib/warranty-coverage";

// PATCH /api/staff/warranties/:id
//  { modelNumber, serialNumber, customerAddress } — fill in details on a warranty
//      imported from Zoho (only while they still say "Not recorded").
//  { action: "user", userName, userMobile } — set / change the product user (gift);
//      empty mobile = the user is the buyer.

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  if (body.action === "user") return setProductUser(id, body, auth.staff.fullName);
  if (body.action === "edit") return editWarranty(id, body, auth.staff);
  if (body.action === "coverage") {
    // Warranty service type (On-Site / In-Store). Super Admin only; "" = not set.
    if (auth.staff.role !== "super_admin") return NextResponse.json({ error: "Only the Super Admin can do this." }, { status: 403 });
    const coverage = body.coverage === "" || body.coverage === null ? null : isServiceCoverage(body.coverage) ? body.coverage : undefined;
    if (coverage === undefined) return NextResponse.json({ error: "Choose On-Site or In-Store." }, { status: 400 });
    const { error } = await supabaseAdmin
      .from("warranties")
      .update({ service_coverage: coverage, edited_at: new Date().toISOString(), edited_by: auth.staff.fullName })
      .eq("id", id);
    if (error) {
      console.error("Warranty service type error:", error);
      return NextResponse.json({ error: "Unable to save." }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }
  if (body.action === "void" || body.action === "unvoid") {
    if (auth.staff.role !== "super_admin") return NextResponse.json({ error: "Only the Super Admin can do this." }, { status: 403 });
    const reason = String(body.reason ?? "").trim().slice(0, 300);
    if (body.action === "void" && reason.length < 5) return NextResponse.json({ error: "Write the reason for voiding." }, { status: 400 });
    const { error } = await supabaseAdmin
      .from("warranties")
      .update(
        body.action === "void"
          ? { status: "void", void_reason: reason, voided_at: new Date().toISOString(), voided_by: auth.staff.fullName }
          : { status: "active", void_reason: null, voided_at: null, voided_by: null }
      )
      .eq("id", id);
    if (error) {
      console.error("Void warranty error:", error);
      return NextResponse.json({ error: "Unable to save." }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }
  const modelNumber = String(body.modelNumber ?? "").trim();
  const serialNumber = String(body.serialNumber ?? "").trim();
  const address = String(body.customerAddress ?? "").trim();

  const { data: w } = await supabaseAdmin
    .from("warranties")
    .select("id, serial_number, customer_address")
    .eq("id", id)
    .maybeSingle();
  if (!w) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (w.serial_number !== NOT_RECORDED && w.customer_address !== NOT_RECORDED) {
    return NextResponse.json({ error: "These details are already filled in." }, { status: 400 });
  }

  const update: Record<string, string> = {};
  if (w.serial_number === NOT_RECORDED) {
    if (!modelNumber || !serialNumber) {
      return NextResponse.json({ error: "Enter the model number and serial number." }, { status: 400 });
    }
    if (serialNumber.toLowerCase() === NOT_RECORDED.toLowerCase()) {
      return NextResponse.json({ error: "Enter the real serial number." }, { status: 400 });
    }
    const { data: used } = await supabaseAdmin
      .from("warranties")
      .select("warranty_number")
      .ilike("serial_number", serialNumber)
      .neq("id", id)
      .limit(1);
    if (used && used.length > 0) {
      return NextResponse.json({ error: `Serial number already registered (${used[0].warranty_number}).` }, { status: 400 });
    }
    update.model_number = modelNumber;
    update.serial_number = serialNumber;
  }
  if (w.customer_address === NOT_RECORDED && address.length >= 5) update.customer_address = address;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

  const { error } = await supabaseAdmin.from("warranties").update(update).eq("id", id);
  if (error) {
    console.error("Update warranty details error:", error);
    return NextResponse.json({ error: "Unable to save." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

async function setProductUser(id: string, body: Record<string, unknown>, staffName: string) {
  const name = String(body.userName ?? "").trim().slice(0, 120);
  const mobile = cleanMobile(body.userMobile);
  const { data: w } = await supabaseAdmin
    .from("warranties")
    .select("id, warranty_number, verification_token, bill_number, product_name, customer_mobile, alternate_mobile")
    .eq("id", id)
    .maybeSingle();
  if (!w) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (mobile) {
    if (!isValidMobile(mobile)) return NextResponse.json({ error: "Enter a valid 10-digit mobile number." }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Enter the recipient's name." }, { status: 400 });
    if (mobile === w.customer_mobile) {
      return NextResponse.json({ error: "This is the customer's own number. Choose \"Not a gift\" instead." }, { status: 400 });
    }
    if (/[^\x20-\x7E\xA0-\xFF]/.test(name)) {
      return NextResponse.json({ error: "Please type the name in English letters." }, { status: 400 });
    }
  }

  const { error } = await supabaseAdmin
    .from("warranties")
    .update({ alternate_name: mobile ? name : null, alternate_mobile: mobile || null })
    .eq("id", id);
  if (error) {
    console.error("Set product user error:", error);
    return NextResponse.json({ error: "Unable to save." }, { status: 500 });
  }

  let login: { created: boolean; password: string | null } = { created: false, password: null };
  if (mobile && mobile !== w.alternate_mobile) {
    const result = await ensureCustomerAccount(mobile, name, String(w.bill_number)).catch(() => ({ created: false }));
    login = { created: result.created, password: result.created ? billPassword(String(w.bill_number)) : null };
    after(() =>
      notifyCustomer({
        name,
        mobile,
        ticketNumber: String(w.warranty_number),
        message: `Your Seven Years warranty is registered for: ${w.product_name}. For service, use your mobile number and warranty no. ${w.warranty_number}.${
          login.created && login.password ? ` My Account login — User ID: ${mobile}, password: ${login.password}.` : ""
        } Your warranty certificate:`,
        link: `${siteUrl()}/warranty/${w.verification_token}`,
      }).catch((e) => console.error("Product user message failed:", e))
    );
  }
  console.info(`Product user on ${w.warranty_number} set by ${staffName}`);
  return NextResponse.json({ success: true, login });
}

// DELETE /api/staff/warranties/:id — Super Admin only.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const blocked = await deleteWarranty(id);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete warranty error:", error);
    return NextResponse.json({ error: "Unable to delete. Please try again." }, { status: 500 });
  }
}

// ------------------------------------------------------------------
// Edit a warranty. Store Manager: customer + product details of their store.
// Super Admin: also serial number and warranty dates.
// ------------------------------------------------------------------
async function editWarranty(
  id: string,
  body: Record<string, unknown>,
  staff: { id: string; role: import("@/lib/roles").Role; storeName: string | null; fullName: string }
) {
  const { data: w } = await supabaseAdmin
    .from("warranties")
    .select("id, store_name, bill_number, customer_mobile, serial_number, status")
    .eq("id", id)
    .maybeSingle();
  if (!w) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const level = await warrantyEditLevel(staff, w.store_name);
  if (!level) return NextResponse.json({ error: "You don't have permission to edit this warranty." }, { status: 403 });

  const text = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
  const update: Record<string, unknown> = {};
  const errors: string[] = [];

  const customerName = text(body.customerName, 120);
  const customerMobile = cleanMobile(body.customerMobile);
  const customerAddress = text(body.customerAddress, 500);
  const productName = text(body.productName, 200);
  const modelNumber = text(body.modelNumber, 80);
  const categoryName = text(body.categoryName, 80);

  if (!customerName) errors.push("Enter the customer name.");
  if (!isValidMobile(customerMobile)) errors.push("Enter a valid 10-digit customer mobile.");
  if (customerAddress.length < 5) errors.push("Enter the customer address.");
  if (!productName) errors.push("Enter the product name.");
  if (!modelNumber) errors.push("Enter the model number.");
  if (categoryName) {
    const cats = await loadActiveCategories().catch(() => new Map());
    if (!cats.has(categoryName.toLowerCase())) errors.push("Choose a valid category.");
  }
  Object.assign(update, {
    customer_name: customerName,
    customer_mobile: customerMobile,
    customer_address: customerAddress,
    product_name: productName,
    model_number: modelNumber,
    ...(categoryName ? { category_name: categoryName } : {}),
  });

  if (level === "full") {
    const serial = text(body.serialNumber, 80);
    const start = String(body.warrantyStartDate ?? "");
    const standardUntil = String(body.standardExpiry ?? "");
    const coveredUntil = String(body.coveredUntil ?? "");
    if (!serial) errors.push("Enter the serial number.");
    if (![start, standardUntil, coveredUntil].every(isISODate)) errors.push("Enter valid warranty dates.");
    else if (standardUntil < start || coveredUntil < standardUntil) errors.push("Dates are in the wrong order (start → standard → covered until).");
    if (serial && serial !== w.serial_number) {
      const { data: used } = await supabaseAdmin.from("warranties").select("warranty_number").eq("serial_number", serial).neq("id", id).limit(1);
      if (used?.length) errors.push(`Serial number already used on ${used[0].warranty_number}.`);
    }
    Object.assign(update, {
      serial_number: serial,
      warranty_start_date: start,
      standard_warranty_expiry_date: standardUntil,
      warranty_expiry_date: coveredUntil,
    });
  }
  if (errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });

  update.edited_at = new Date().toISOString();
  update.edited_by = staff.fullName;
  let { error } = await supabaseAdmin.from("warranties").update(update).eq("id", id);
  if (error && /edited_/.test(error.message)) {
    delete update.edited_at;
    delete update.edited_by;
    ({ error } = await supabaseAdmin.from("warranties").update(update).eq("id", id));
  }
  if (error) {
    console.error("Edit warranty error:", error);
    return NextResponse.json({ error: "Unable to save. Please try again." }, { status: 500 });
  }
  // New customer mobile: make sure they can log in.
  if (customerMobile !== w.customer_mobile) {
    after(() => ensureCustomerAccount(customerMobile, customerName, String(w.bill_number)).then(() => undefined).catch(() => undefined));
  }
  return NextResponse.json({ success: true });
}
