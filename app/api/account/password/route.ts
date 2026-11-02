import { NextResponse } from "next/server";
import {
  changeCustomerPassword,
  CUSTOMER_COOKIE,
  customerCookieOptions,
  customerSessionValue,
  getCurrentCustomer,
} from "@/lib/customer-auth";

// POST /api/account/password  { currentPassword, newPassword }
export async function POST(request: Request) {
  const customer = await getCurrentCustomer();
  if (!customer) return NextResponse.json({ error: "Please log in again." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { currentPassword?: string; newPassword?: string };
  const result = await changeCustomerPassword(
    customer.mobile,
    String(body.currentPassword ?? ""),
    String(body.newPassword ?? "")
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  // Other devices are logged out; keep this one logged in.
  const response = NextResponse.json({ success: true });
  response.cookies.set(CUSTOMER_COOKIE, customerSessionValue(customer.mobile, result.sessionVersion), customerCookieOptions);
  return response;
}
