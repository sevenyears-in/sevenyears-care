import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

// POST /api/staff/alerts  { id? }  → mark one alert (or all) as read.

export async function POST(request: Request) {
  const auth = await requireStaff("staff");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  let query = supabaseAdmin
    .from("staff_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("staff_id", auth.staff.id)
    .is("read_at", null);
  if (body.id) query = query.eq("id", body.id);

  const { error } = await query;
  if (error) {
    console.error("Mark alerts read error:", error);
    return NextResponse.json({ error: "Unable to update alerts." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
