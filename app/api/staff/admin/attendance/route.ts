import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";
import { attendanceSettings, hashKey, newSyncKey, saveAttendanceSettings } from "@/lib/attendance";

// Settings → Attendance (Super Admin).
// GET  → status (last sync, punches today, codes not linked to a staff user)
// POST { action: "newKey" } → a new sync key, shown once (the old one stops working)

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
    supabaseAdmin.from("staff_users").select("employee_code").not("employee_code", "is", null),
  ]);
  const linked = new Set((staff.data ?? []).map((s) => String(s.employee_code).trim().toUpperCase()));
  const codesToday = [...new Set((punches.data ?? []).map((p) => String(p.emp_code)))];
  return NextResponse.json({
    hasKey: Boolean(settings.keyHash),
    keyCreatedAt: settings.keyCreatedAt ?? null,
    lastSyncAt: settings.lastSyncAt ?? null,
    lastSyncCount: settings.lastSyncCount ?? 0,
    punchesToday: punches.data?.length ?? 0,
    peopleToday: codesToday.length,
    unlinkedCodes: codesToday.filter((c) => !linked.has(c)).sort(),
    linkedStaff: linked.size,
    tableReady: !punches.error,
  });
}

export async function POST(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "newKey") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const key = newSyncKey();
  await saveAttendanceSettings({ keyHash: hashKey(key), keyCreatedAt: new Date().toISOString() });
  return NextResponse.json({ key });
}
