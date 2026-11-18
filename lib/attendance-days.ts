// Day-by-day attendance rules, shared by the duties calendar and the monthly performance figures
// (so both always show the same numbers). Server only.

import { fetchAll } from "@/lib/fetch-all";
import { supabaseAdmin } from "@/lib/supabase/server";
import { attendanceCode } from "@/lib/attendance";
import { todayISO } from "@/lib/helpers";
import { monthRange } from "@/lib/performance-rules";

/** A single punch this long after the shift start can't be the arrival (the in- or out-punch is missing). */
export const ONE_PUNCH_AFTER_MIN = 120;

export type DayIndex = {
  /** code → day → punch times (minutes after midnight, India time), sorted, double presses removed. */
  byCode: Map<string, Map<string, number[]>>;
  /** code → day → punch times as ISO (for showing). */
  isoByCode: Map<string, Map<string, string[]>>;
  /** Days each store's punching machine sent something. */
  storeDays: Map<string, Set<string>>;
  /** Days any machine sent something. */
  allDays: Set<string>;
};

export async function loadMonthPunches(month: string): Promise<DayIndex> {
  const { from, to } = monthRange(month);
  const [rows, devices] = await Promise.all([
    fetchAll<{ emp_code: string; punch_time: string; device: string | null }>((a, b) =>
      supabaseAdmin
        .from("attendance_punches")
        .select("emp_code, punch_time, device")
        .gte("punch_time", `${from}T00:00:00+05:30`)
        .lte("punch_time", `${to}T23:59:59+05:30`)
        .order("punch_time")
        .order("id")
        .range(a, b)
    ),
    import("@/lib/store-open-close").then((m) => m.deviceStores()).catch(() => ({}) as Record<string, string>),
  ]);
  const byCode = new Map<string, Map<string, number[]>>();
  const isoByCode = new Map<string, Map<string, string[]>>();
  const storeDays = new Map<string, Set<string>>();
  const allDays = new Set<string>();
  const lastAt = new Map<string, number>();
  for (const r of rows) {
    const t = new Date(String(r.punch_time));
    const day = todayISO(t);
    allDays.add(day);
    const store = r.device ? devices[String(r.device)] : undefined;
    if (store) {
      if (!storeDays.has(store)) storeDays.set(store, new Set());
      storeDays.get(store)!.add(day);
    }
    const code = attendanceCode(r.emp_code);
    // Two presses within 2 minutes are one punch.
    const prev = lastAt.get(code);
    if (prev !== undefined && t.getTime() - prev < 120_000) continue;
    lastAt.set(code, t.getTime());
    const ist = new Date(t.getTime() + 5.5 * 3_600_000);
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (!byCode.has(code)) {
      byCode.set(code, new Map());
      isoByCode.set(code, new Map());
    }
    const m = byCode.get(code)!;
    if (!m.has(day)) {
      m.set(day, []);
      isoByCode.get(code)!.set(day, []);
    }
    m.get(day)!.push(mins);
    isoByCode.get(code)!.get(day)!.push(t.toISOString());
  }
  return { byCode, isoByCode, storeDays, allDays };
}

/**
 * Did the punching machine of this store send anything that day? Stores without a machine (or
 * before it was connected) fall back to "any machine sent something".
 */
export function hasData(idx: DayIndex, store: string | null, day: string) {
  const s = store ? idx.storeDays.get(store.toUpperCase()) : undefined;
  if (s && s.size) {
    // Before the store's machine sent its first punch this month, it wasn't connected yet.
    const first = [...s].sort()[0];
    if (day < first) return false;
    return s.has(day);
  }
  return idx.allDays.has(day);
}

/**
 * Late minutes of one day (0 = on time), or onePunch when the day has a single punch long after the
 * start (or only punches after the shift ended): the arrival isn't known, so it isn't counted late.
 */
export function judgeDay(mins: number[], shift: { start: number; end: number | null }, grace: number) {
  if (!mins.length) return { late: 0, onePunch: false };
  const first = mins[0];
  const afterEnd = shift.end !== null && shift.end > shift.start && first > shift.end;
  const lone = mins.length === 1 && first > shift.start + ONE_PUNCH_AFTER_MIN;
  if (afterEnd || lone) return { late: 0, onePunch: true };
  const late = first - (shift.start + grace);
  return { late: late > 0 ? late : 0, onePunch: false };
}
