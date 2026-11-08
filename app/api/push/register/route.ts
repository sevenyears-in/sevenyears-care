import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

// POST /api/push/register { token, platform } — the mobile app tells us its notification token,
// linked to whoever is logged in on that phone (for "your service is ready" style alerts).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: string; platform?: string };
  const token = String(body.token ?? "").trim();
  if (!/^[\w:.-]{20,4096}$/.test(token)) return NextResponse.json({ error: "Invalid token." }, { status: 400 });
  const [customer, staff] = await Promise.all([getCurrentCustomer(), getCurrentStaff()]);
  const { error } = await supabaseAdmin.from("push_tokens").upsert({
    token,
    platform: body.platform === "ios" ? "ios" : "android",
    customer_mobile: customer?.mobile ?? null,
    staff_id: staff?.id ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error("Push token save error:", error);
  return NextResponse.json({ success: true });
}
