import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { NOT_RECORDED } from "@/lib/zoho-import";
import { after } from "next/server";
import { billPassword, ensureCustomerAccount } from "@/lib/customer-auth";
import { cleanMobile, isValidMobile } from "@/lib/helpers";
import { notifyCustomer, siteUrl } from "@/lib/notify";

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
    if (!name) return NextResponse.json({ error: "Enter the product user's name." }, { status: 400 });
    if (mobile === w.customer_mobile) {
      return NextResponse.json({ error: "This is the buyer's own number — leave it empty if the buyer uses the product." }, { status: 400 });
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
