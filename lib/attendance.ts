// "Who's in the store now", from eTimeTrackLite punches (server only).
// First punch of the day = arrival; last punch = leaving; punches in between are breaks.

import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";

export const ATTENDANCE_KEY = "attendance";

export type Presence = { status: "in" | "out"; firstIn: string; lastPunch: string; punches: number };
export type AttendanceSettings = {
  keyHash?: string;
  keyCreatedAt?: string;
  lastSyncAt?: string;
  lastSyncCount?: number;
  /** Version the office-PC script reports (old scripts send none). Version 2 can pull older punches. */
  scriptVersion?: number;
  /** Older punches asked for: from this day (YYYY-MM-DD). Cleared when the office PC has sent them. */
  backfillFrom?: string | null;
  backfillAskedAt?: string | null;
  backfillDoneAt?: string | null;
  backfillDoneFrom?: string | null;
  backfillSent?: number;
};

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

/** eTimeTrackLite employee code ⇄ staff User ID (same number; "01009" = "1009"). */
export function attendanceCode(code: unknown) {
  const c = String(code ?? "").trim().toUpperCase();
  return /^\d+$/.test(c) ? String(Number(c)) : c;
}

let cache: { at: number; value: Map<string, Presence> } | null = null;

/** Presence today by staff id (matched by User ID). */
export async function presenceToday(): Promise<Map<string, Presence>> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const result = new Map<string, Presence>();
  const [{ data: staff }, { data: punches }] = await Promise.all([
    supabaseAdmin.from("staff_users").select("id, user_id").eq("is_active", true),
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
    const code = attendanceCode(p.emp_code);
    byCode.set(code, [...(byCode.get(code) ?? []), p.punch_time]);
  }
  for (const s of staff as { id: string; user_id: string }[]) {
    const times = byCode.get(attendanceCode(s.user_id));
    if (!times?.length) continue;
    // Two punches within 2 minutes are one (a double press on the machine).
    const clean = times.filter((t, i) => i === 0 || new Date(t).getTime() - new Date(times[i - 1]).getTime() > 120_000);
    result.set(String(s.id), {
      // First punch = arrival, last punch of the day = leaving. Punches in between are
      // lunch / tea breaks, so a person stays "in" through them. They count as gone only when
      // their last punch was an out-punch and nothing has followed for 3 hours.
      status:
        clean.length % 2 === 1 || Date.now() - new Date(clean[clean.length - 1]).getTime() < 3 * 3600_000 ? "in" : "out",
      firstIn: clean[0],
      lastPunch: clean[clean.length - 1],
      punches: clean.length,
    });
  }
  cache = { at: Date.now(), value: result };
  return result;
}

/** User IDs (normalised) that have punched in the last 31 days. */
export async function recentAttendanceCodes(): Promise<Set<string>> {
  const since = new Date(Date.now() - 31 * 86400_000).toISOString();
  const { data } = await supabaseAdmin.from("attendance_punches").select("emp_code").gte("punch_time", since).limit(20000);
  return new Set((data ?? []).map((p) => attendanceCode(p.emp_code)));
}
