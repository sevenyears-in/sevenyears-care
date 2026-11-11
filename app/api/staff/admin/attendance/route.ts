import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";
import { attendanceCode, attendanceSettings, hashKey, newSyncKey, saveAttendanceSettings } from "@/lib/attendance";

// Settings → Attendance (Super Admin).
// GET  → status (last sync, punches today, codes not linked to a staff user)
// POST { action: "newKey" } → a new sync key, shown once (the old one stops working)
// POST { action: "backfill", from } → the office PC sends all punches from that day at its next run

export async function GET() {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const [settings, punches, staff] = await Promise.all([
    attendanceSettings(),
    supabaseAdmin
      .from("attendance_punches")
      .select("emp_code")
      .gte("punch_time", `${todayISO()}T00:00:00+05:30`)
      .limit(5000),
    supabaseAdmin.from("staff_users").select("user_id").eq("is_active", true),
  ]);
  const userIds = new Set((staff.data ?? []).map((s) => attendanceCode(s.user_id)));
  const codesToday = [...new Set((punches.data ?? []).map((p) => attendanceCode(p.emp_code)))];
  return NextResponse.json({
    hasKey: Boolean(settings.keyHash),
    keyCreatedAt: settings.keyCreatedAt ?? null,
    lastSyncAt: settings.lastSyncAt ?? null,
    lastSyncCount: settings.lastSyncCount ?? 0,
    punchesToday: punches.data?.length ?? 0,
    peopleToday: codesToday.length,
    unlinkedCodes: codesToday.filter((c) => !userIds.has(c)).sort(),
    linkedStaff: codesToday.filter((c) => userIds.has(c)).length,
    tableReady: !punches.error,
    scriptVersion: settings.scriptVersion ?? 0,
    backfillFrom: settings.backfillFrom ?? null,
    backfillAskedAt: settings.backfillAskedAt ?? null,
    backfillDoneAt: settings.backfillDoneAt ?? null,
    backfillDoneFrom: settings.backfillDoneFrom ?? null,
    backfillSent: settings.backfillSent ?? 0,
  });
}

export async function POST(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { action?: string; from?: string };
  if (body.action === "backfill") {
    // Pull older punches: the office PC sends everything from this day at its next run (every 2 minutes).
    const from = String(body.from ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(from))) return NextResponse.json({ error: "Choose a date." }, { status: 400 });
    if (from > todayISO()) return NextResponse.json({ error: "The date is in the future." }, { status: 400 });
    if (from < todayISO(new Date(Date.now() - 400 * 86400_000))) return NextResponse.json({ error: "Choose a date in the last 13 months." }, { status: 400 });
    await saveAttendanceSettings({ backfillFrom: from, backfillAskedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "backfillCancel") {
    await saveAttendanceSettings({ backfillFrom: null });
    return NextResponse.json({ ok: true });
  }
  if (body.action !== "newKey") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const key = newSyncKey();
  await saveAttendanceSettings({ keyHash: hashKey(key), keyCreatedAt: new Date().toISOString() });
  return NextResponse.json({ key });
}
