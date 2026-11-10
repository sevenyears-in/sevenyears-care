import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { attendanceCode } from "@/lib/attendance";
import { todayISO } from "@/lib/helpers";
import { dutyAccess, isJustifyKind } from "@/lib/duties";
import { forgetMonthReport, monthReport } from "@/lib/performance";
import { ROLE_LABELS } from "@/lib/roles";

// POST /api/staff/performance/duties
//   { action: "justify", userId, day, kind, reason }   → HR / Store Manager / Admin
//   { action: "remove",  userId, day }
export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = attendanceCode(body.userId);
  const day = typeof body.day === "string" && /^20\d\d-\d\d-\d\d$/.test(body.day) ? body.day : null;
  if (!userId || !day) return NextResponse.json({ error: "Choose the person and the day." }, { status: 400 });
  if (day > todayISO()) return NextResponse.json({ error: "Only past days can be justified." }, { status: 400 });

  // The person's store decides which Store Manager may justify.
  const report = await monthReport(day.slice(0, 7));
  const store = report.stores.find((s) => s.people.some((p) => p.userId === userId))?.store ?? null;
  const access = await dutyAccess(auth.staff, userId, store);
  if (!access.justify) return NextResponse.json({ error: "Only HR, the Store Manager or an Admin can do this." }, { status: 403 });
  if (attendanceCode(auth.staff.userId) === userId && !["super_admin", "admin"].includes(auth.staff.role))
    return NextResponse.json({ error: "You cannot justify your own duties." }, { status: 403 });

  if (body.action === "remove") {
    await supabaseAdmin.from("duty_justifications").delete().eq("user_id", userId).eq("day", day);
    forgetMonthReport();
    return NextResponse.json({ ok: true });
  }

  const kind = body.kind;
  if (!isJustifyKind(kind)) return NextResponse.json({ error: "Choose a reason." }, { status: 400 });
  const reason = String(body.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (kind === "other" && reason.length < 3) return NextResponse.json({ error: "Write the reason." }, { status: 400 });
  const { error } = await supabaseAdmin.from("duty_justifications").upsert({
    user_id: userId,
    day,
    kind,
    reason: reason || null,
    by_name: `${auth.staff.fullName} (${auth.staff.userId})`,
    by_role: auth.staff.access.roleLabel || ROLE_LABELS[auth.staff.role],
    created_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: "Could not save. Ask the Super Admin to run the latest database update." }, { status: 500 });
  forgetMonthReport();
  return NextResponse.json({ ok: true });
}
