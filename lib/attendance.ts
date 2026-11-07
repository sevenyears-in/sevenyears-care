// "Who's in the store now", from eTimeTrackLite punches (server only).
// A person is IN when they have an odd number of punches today (in, out, in…).

import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";

export const ATTENDANCE_KEY = "attendance";

export type Presence = { status: "in" | "out"; firstIn: string; lastPunch: string; punches: number };
export type AttendanceSettings = { keyHash?: string; keyCreatedAt?: string; lastSyncAt?: string; lastSyncCount?: number };

export const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");
export const newSyncKey = () => randomBytes(24).toString("base64url");

export async function attendanceSettings(): Promise<AttendanceSettings> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", ATTENDANCE_KEY).maybeSingle();
  return (data?.value as AttendanceSettings) ?? {};
}

export async function saveAttendanceSettings(change: Partial<AttendanceSettings>) {
  const current = await attendanceSettings();
  const value = { ...current, ...change };
  await supabaseAdmin.from("app_settings").upsert({ key: ATTENDANCE_KEY, value, updated_at: new Date().toISOString() });
  return value;
}

let cache: { at: number; value: Map<string, Presence> } | null = null;

/** Presence today by staff id (only staff with an employee code). */
export async function presenceToday(): Promise<Map<string, Presence>> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const result = new Map<string, Presence>();
  const [{ data: staff }, { data: punches }] = await Promise.all([
    supabaseAdmin.from("staff_users").select("id, employee_code").eq("is_active", true).not("employee_code", "is", null),
    supabaseAdmin
      .from("attendance_punches")
      .select("emp_code, punch_time")
      .gte("punch_time", `${todayISO()}T00:00:00+05:30`)
      .order("punch_time", { ascending: true })
      .limit(5000),
  ]);
  if (!staff?.length || !punches) {
    cache = { at: Date.now(), value: result };
    return result;
  }
  const byCode = new Map<string, string[]>();
  for (const p of punches as { emp_code: string; punch_time: string }[]) {
    const code = p.emp_code.trim().toUpperCase();
    byCode.set(code, [...(byCode.get(code) ?? []), p.punch_time]);
  }
  for (const s of staff as { id: string; employee_code: string }[]) {
    const times = byCode.get(String(s.employee_code).trim().toUpperCase());
    if (!times?.length) continue;
    // Two punches within 2 minutes are one (a double press on the machine).
    const clean = times.filter((t, i) => i === 0 || new Date(t).getTime() - new Date(times[i - 1]).getTime() > 120_000);
    result.set(String(s.id), {
      status: clean.length % 2 === 1 ? "in" : "out",
      firstIn: clean[0],
      lastPunch: clean[clean.length - 1],
      punches: clean.length,
    });
  }
  cache = { at: Date.now(), value: result };
  return result;
}

/** Is attendance set up (any staff with an employee code)? */
export async function attendanceEnabled() {
  const { count } = await supabaseAdmin
    .from("staff_users")
    .select("id", { count: "exact", head: true })
    .not("employee_code", "is", null);
  return (count ?? 0) > 0;
}
