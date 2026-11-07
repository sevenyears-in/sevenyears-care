import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cleanMobile } from "@/lib/helpers";
import { normaliseUserId } from "@/lib/auth";
import { POST as customerLogin } from "@/app/api/account/login/route";
import { POST as staffLogin } from "@/app/api/staff/login/route";

// POST /api/login { userId, password } — one login for the app.
// A 10-digit mobile number is a customer; anything else is a staff User ID.
// (If a staff User ID happens to be all digits, staff is tried after the customer.)
// Uses the existing customer / staff logins, so their protection against
// password guessing still applies.

function call(handler: (r: Request) => Promise<Response>, body: object) {
  return handler(
    new Request("http://internal/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

async function withRedirect(res: Response, redirect: string) {
  const data = await res.json().catch(() => ({}));
  const out = NextResponse.json(res.ok ? { success: true, redirect } : data, { status: res.status });
  for (const cookie of res.headers.getSetCookie()) out.headers.append("set-cookie", cookie);
  return out;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { userId?: string; password?: string };
  const raw = String(body.userId ?? "").trim();
  const password = String(body.password ?? "");
  if (!raw || !password) return NextResponse.json({ error: "Enter your User ID and password." }, { status: 400 });

  const mobile = cleanMobile(raw);
  if (/^[6-9]\d{9}$/.test(mobile) && /^[+\d\s-]+$/.test(raw)) {
    const res = await call(customerLogin, { mobile, password });
    if (res.ok) return withRedirect(res, "/account");
    // Maybe a staff User ID made of digits.
    const { data: staff } = await supabaseAdmin.from("staff_users").select("id").eq("user_id", normaliseUserId(raw)).maybeSingle();
    if (!staff) return withRedirect(res, "/account");
  }
  return withRedirect(await call(staffLogin, { userId: raw, password }), "/staff");
}
