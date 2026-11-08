import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { supabaseAdmin } from "@/lib/supabase/server";

// POST /api/ping — "I'm here": sent every minute while a logged-in person has the app / site open.
export async function POST() {
  const [staff, customer] = await Promise.all([getCurrentStaff().catch(() => null), getCurrentCustomer().catch(() => null)]);
  const now = new Date().toISOString();
  await Promise.all([
    staff ? supabaseAdmin.from("staff_users").update({ last_seen_at: now }).eq("id", staff.id) : null,
    customer ? supabaseAdmin.from("customer_accounts").update({ last_seen_at: now }).eq("mobile", customer.mobile) : null,
  ]);
  return NextResponse.json({ ok: true });
}
