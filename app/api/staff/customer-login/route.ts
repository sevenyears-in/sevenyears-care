import { NextResponse } from "next/server";
import { requireStaff, hashPassword } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { billPassword } from "@/lib/customer-auth";

// POST /api/staff/customer-login { warrantyId }
// Customer forgot their password: reset it to the last 4 digits of this warranty's bill number.
export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { warrantyId?: string };
  const id = String(body.warrantyId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Warranty not found." }, { status: 404 });

  const { data: w } = await supabaseAdmin
    .from("warranties")
    .select("customer_mobile, customer_name, bill_number")
    .eq("id", id)
    .maybeSingle();
  if (!w) return NextResponse.json({ error: "Warranty not found." }, { status: 404 });

  const password = billPassword(String(w.bill_number));
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
    message: `Customer login reset. User ID ${w.customer_mobile}, password ${password} (last 4 digits of bill ${w.bill_number}).`,
  });
}
