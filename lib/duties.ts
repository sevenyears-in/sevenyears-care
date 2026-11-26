// Day-by-day duties of one person, and who may justify an absent day. Server only.

import type { StaffUser } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase/server";
import { attendanceCode } from "@/lib/attendance";
import { todayISO } from "@/lib/helpers";
import { monthRange } from "@/lib/performance-rules";
import { performanceAccess } from "@/lib/performance-access";
import { hasData, judgeDay, loadMonthPunches } from "@/lib/attendance-days";

export const JUSTIFY_KINDS = [
  { key: "leave", label: "Approved leave" },
  { key: "week_off", label: "Weekly off" },
  { key: "official", label: "Official work / training" },
  { key: "missed_punch", label: "Was present — punch missed" },
  { key: "other", label: "Other (write the reason)" },
] as const;
export type JustifyKind = (typeof JUSTIFY_KINDS)[number]["key"];
export const isJustifyKind = (v: unknown): v is JustifyKind => JUSTIFY_KINDS.some((k) => k.key === v);

const HR_ROLES = ["hr_head", "hr_executive"];

/** Who may look at / justify a person's duties (personStore = the store whose pool they share). */
export async function dutyAccess(staff: StaffUser, personId: string, personStore: string | null) {
  const me = attendanceCode(staff.userId) === attendanceCode(personId);
  const hr = HR_ROLES.includes(staff.role);
  const admin = isAdmin(staff.role);
  const access = await performanceAccess(staff);
  const store = (personStore ?? "").toUpperCase();
  const manager = (access.group === "sm" || staff.role === "store_manager") && !!store && (staff.storeName ?? "").toUpperCase() === store;
  const sees = me || hr || admin || access.teamAll || (store && access.teamStores.includes(store));
  return { view: Boolean(sees), justify: hr || admin || manager };
}

export type DutyDay = {
  date: string;
  weekday: number;
  status: "present" | "justified" | "absent" | "no_data" | "today" | "future";
  first?: string;
  last?: string;
  punches?: number;
  /** Minutes late (first punch after the shift start + grace). */
  late?: number;
  /** Only one punch, long after the start (or only after the shift ended): arrival not known, not counted late. */
  onePunch?: boolean;
  justification?: { kind: string; reason: string | null; by: string; at: string };
};

export type DutyOptions = {
  /** Shift of the person on a day (start / end in minutes after midnight). */
  shift: (day: string) => { start: number; end: number | null };
  grace: number;
  /** Store of the person on a day (for "no punching data" days). */
  store: (day: string) => string | null;
  /** The month's punches, when already loaded (checking many people at once). */
  index?: Awaited<ReturnType<typeof loadMonthPunches>>;
};

export async function dutyDays(personId: string, month: string, opts: DutyOptions): Promise<DutyDay[]> {
  const { from, to, days } = monthRange(month);
  const code = attendanceCode(personId);
  const [index, justRes] = await Promise.all([
    opts.index ?? loadMonthPunches(month),
    supabaseAdmin.from("duty_justifications").select("day, kind, reason, by_name, created_at").eq("user_id", code).gte("day", from).lte("day", to),
  ]);
  const mins = index.byCode.get(code) ?? new Map<string, number[]>();
  const isos = index.isoByCode.get(code) ?? new Map<string, string[]>();
  const just = new Map((justRes.data ?? []).map((j) => [String(j.day), j]));
  const today = todayISO();
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const out: DutyDay[] = [];
  for (let i = 1; i <= days; i++) {
    const date = `${month}-${String(i).padStart(2, "0")}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const p = isos.get(date);
    const j = just.get(date);
    const day: DutyDay = { date, weekday, status: "future" };
    if (p?.length) {
      day.status = "present";
      day.first = time(p[0]);
      day.last = p.length > 1 ? time(p[p.length - 1]) : undefined;
      day.punches = p.length;
      const judged = judgeDay(mins.get(date) ?? [], opts.shift(date), opts.grace);
      if (judged.onePunch) day.onePunch = true;
      else if (judged.late > 0) day.late = judged.late;
    } else if (j) day.status = "justified";
    else if (date > today) day.status = "future";
    else if (date === today) day.status = "today";
    else if (!hasData(index, opts.store(date), date)) day.status = "no_data";
    else day.status = "absent";
    if (j) day.justification = { kind: String(j.kind), reason: (j.reason as string) ?? null, by: String(j.by_name), at: String(j.created_at) };
    out.push(day);
  }
  return out;
}
