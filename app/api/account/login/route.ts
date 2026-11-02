import { NextResponse } from "next/server";
import { cleanMobile } from "@/lib/helpers";
import { CUSTOMER_COOKIE, customerCookieOptions, customerLogin, customerSessionValue } from "@/lib/customer-auth";

// POST /api/account/login  { mobile, password }
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { mobile?: string; password?: string };
    const result = await customerLogin(cleanMobile(body.mobile), String(body.password ?? "").trim());
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const response = NextResponse.json({ success: true });
    response.cookies.set(CUSTOMER_COOKIE, customerSessionValue(result.mobile, result.sessionVersion), customerCookieOptions);
    return response;
  } catch (error) {
    console.error("Customer login error:", error);
    return NextResponse.json({ error: "Unable to log in right now. Please try again." }, { status: 500 });
  }
}
