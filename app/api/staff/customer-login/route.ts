import { NextResponse } from "next/server";
import { requireStaff, hashPassword } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { billPassword } from "@/lib/customer-auth";
import { canViewTicket, getTicket } from "@/lib/tickets";

// POST /api/staff/customer-login { warrantyId }
// Customer forgot their password: reset it to the last 4 digits of this warranty's bill number.
export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { warrantyId?: string; ticketType?: string; ticketId?: string };

  // From a complaint / service request (customer may have no warranty): reset to the last 4 digits of the mobile.
  let w: { customer_mobile: string; customer_name: string | null; bill_number: string | null } | null = null;
  if (body.ticketId) {
    const type = body.ticketType === "service" ? "service" : "complaint";
    const ticket = await getTicket(type, String(body.ticketId));
    if (!ticket || !canViewTicket(auth.staff, type, ticket) || !ticket.contactMobile) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }
    w = { customer_mobile: ticket.contactMobile, customer_name: ticket.contactName, bill_number: null };
  } else {
    const id = String(body.warrantyId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Warranty not found." }, { status: 404 });
    const { data } = await supabaseAdmin
      .from("warranties")
      .select("customer_mobile, customer_name, bill_number")
      .eq("id", id)
      .maybeSingle();
    w = data ?? null;
  }
  if (!w) return NextResponse.json({ error: "Warranty not found." }, { status: 404 });

  const password = w.bill_number ? billPassword(String(w.bill_number)) : String(w.customer_mobile).slice(-4);
  const { data: existing } = await supabaseAdmin
    .from("customer_accounts")
    .select("session_version")
    .eq("mobile", w.customer_mobile)
    .maybeSingle();

  const { error } = existing
    ? await supabaseAdmin
        .from("customer_accounts")
        .update({
          password_hash: hashPassword(password),
          session_version: (existing.session_version ?? 1) + 1,
          failed_attempts: 0,
          locked_until: null,
        })
        .eq("mobile", w.customer_mobile)
    : await supabaseAdmin.from("customer_accounts").insert({
        mobile: w.customer_mobile,
        full_name: w.customer_name,
        password_hash: hashPassword(password),
      });

  if (error) {
    console.error("Reset customer login error:", error);
    return NextResponse.json({ error: "Unable to reset the customer's password." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: `Customer login reset. User ID ${w.customer_mobile}, password ${password} (last 4 digits of ${
      w.bill_number ? `bill ${w.bill_number}` : "their mobile number"
    }). They can also use "Forgot password?" on the login page.`,
  });
}
