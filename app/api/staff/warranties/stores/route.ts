import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { getStores } from "@/lib/stores";

// GET /api/staff/warranties/stores — store names for the Warranties filter.
export async function GET() {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const { stores } = await getStores().catch(() => ({ stores: [] as { name: string }[] }));
  return NextResponse.json({ stores: stores.map((s) => s.name), myStore: auth.staff.storeName ?? "" });
}
