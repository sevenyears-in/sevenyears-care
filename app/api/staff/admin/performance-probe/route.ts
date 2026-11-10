import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { zohoSalesProbe } from "@/lib/zoho";

// GET /api/staff/admin/performance-probe?date=YYYY-MM-DD — Super Admin only (field check, no customer data).
export async function GET(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const date = new URL(request.url).searchParams.get("date") || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return NextResponse.json(await zohoSalesProbe(date));
}
