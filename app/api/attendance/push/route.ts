import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { attendanceSettings, hashKey, saveAttendanceSettings } from "@/lib/attendance";

// POST /api/attendance/push — called every 2 minutes by the sync script on the
// office PC (eTimeTrackLite). Header "x-sync-key" must match the key created in
// Settings → Attendance. Body: { punches: [{ id, code, time, device, direction }] }

export async function POST(request: Request) {
  const settings = await attendanceSettings();
  const key = request.headers.get("x-sync-key") ?? "";
  const ok =
    settings.keyHash &&
    key.length > 10 &&
    timingSafeEqual(Buffer.from(hashKey(key)), Buffer.from(settings.keyHash));
  if (!ok) return NextResponse.json({ error: "Not allowed." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { punches?: unknown[] };
  const list = Array.isArray(body.punches) ? body.punches.slice(0, 5000) : [];
  const rows = list
    .map((p) => p as Record<string, unknown>)
    .map((p) => ({
      source_id: String(p.id ?? "").slice(0, 80),
      emp_code: String(p.code ?? "").trim().toUpperCase().slice(0, 40),
      punch_time: String(p.time ?? ""),
      device: p.device ? String(p.device).slice(0, 80) : null,
      direction: p.direction ? String(p.direction).slice(0, 20) : null,
    }))
    .filter((r) => r.source_id && r.emp_code && !Number.isNaN(Date.parse(r.punch_time)));

  let saved = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabaseAdmin
      .from("attendance_punches")
      .upsert(rows.slice(i, i + 500), { onConflict: "source_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("Attendance push error:", error);
      return NextResponse.json({ error: "Unable to save." }, { status: 500 });
    }
    saved += data?.length ?? 0;
  }
  await saveAttendanceSettings({ lastSyncAt: new Date().toISOString(), lastSyncCount: saved });
  return NextResponse.json({ ok: true, received: rows.length, saved });
}
