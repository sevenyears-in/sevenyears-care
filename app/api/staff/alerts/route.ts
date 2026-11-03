import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

// GET  /api/staff/alerts?since=<ISO>  → unread count + alerts newer than `since` (for the live bell).
// POST /api/staff/alerts  { id? }  → mark one alert (or all) as read.

export async function GET(request: Request) {
  const auth = await requireStaff("staff");
  if (auth.response) return auth.response;

  const since = new URL(request.url).searchParams.get("since");
  const [{ count }, latest] = await Promise.all([
    supabaseAdmin
      .from("staff_notifications")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", auth.staff.id)
      .is("read_at", null),
    since && !Number.isNaN(Date.parse(since))
      ? supabaseAdmin
          .from("staff_notifications")
          .select("id, ticket_type, ticket_id, title, body, created_at")
          .eq("staff_id", auth.staff.id)
          .is("read_at", null)
          .gt("created_at", new Date(since).toISOString())
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  return NextResponse.json(
    { unread: count ?? 0, latest: latest.data ?? [], now: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const auth = await requireStaff("staff");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { id?: string; test?: boolean };

  // "Send me a test alert" (profile menu) — checks sound, pop-up and phone notification.
  if (body.test) {
    const { error } = await supabaseAdmin.from("staff_notifications").insert({
      staff_id: auth.staff.id,
      ticket_type: null,
      ticket_id: null,
      ticket_number: null,
      title: "Test alert",
      body: "Alerts are working on this device. 🎉",
    });
    if (error) {
      console.error("Test alert error:", error);
      return NextResponse.json({ error: "Unable to send a test alert." }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }
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
