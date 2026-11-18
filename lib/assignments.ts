// Shift and store of each staff member over time (server only).
// Each row says "from this date, this person's shift / store is X". The row with the latest
// valid_from on or before a day is the one for that day. Before a person's first row, the
// defaults apply (first shift in Settings; the store on their staff account).

import { supabaseAdmin } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { attendanceCode } from "@/lib/attendance";
import { timeToMinutes, DEFAULT_PERFORMANCE_SETTINGS, type PerformanceSettings } from "@/lib/performance-rules";

export type AssignmentKind = "shift" | "store";
export type Assignment = { id: number; userId: string; kind: AssignmentKind; value: string; validFrom: string; note: string | null; createdBy: string | null; createdAt: string };
export type Assignments = Map<string, { shift: Assignment[]; store: Assignment[] }>;

const TTL = 20_000;
let cache: { at: number; value: Assignments } | null = null;

export function forgetAssignments() {
  cache = null;
}

export async function loadAssignments(fresh = false): Promise<Assignments> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.value;
  const map: Assignments = new Map();
  try {
    const rows = await fetchAll<Record<string, unknown>>((a, b) =>
      supabaseAdmin.from("staff_assignments").select("*").order("valid_from").order("id").range(a, b)
    );
    for (const r of rows) {
      const userId = attendanceCode(r.user_id);
      const kind = r.kind === "store" ? "store" : "shift";
      if (!map.has(userId)) map.set(userId, { shift: [], store: [] });
      map.get(userId)![kind].push({
        id: Number(r.id),
        userId,
        kind,
        value: String(r.value),
        validFrom: String(r.valid_from).slice(0, 10),
        note: r.note ? String(r.note) : null,
        createdBy: r.created_by ? String(r.created_by) : null,
        createdAt: String(r.created_at),
      });
    }
  } catch {
    // Table not created yet: everyone keeps the defaults.
  }
  cache = { at: Date.now(), value: map };
  return map;
}

/** The value in force on a day (YYYY-MM-DD), or null before the first row. */
export function valueOn(list: Assignment[] | undefined, day: string): string | null {
  let v: string | null = null;
  for (const a of list ?? []) {
    if (a.validFrom <= day) v = a.value;
    else break;
  }
  return v;
}

type ShiftSettings = Pick<PerformanceSettings, "shifts" | "personShifts">;

/** Shift (name, start minutes) of a person on a day. */
export function shiftOn(s: ShiftSettings, all: Assignments, userId: string, day: string) {
  const list = s.shifts?.length ? s.shifts : DEFAULT_PERFORMANCE_SETTINGS.shifts;
  const code = attendanceCode(userId);
  const name = valueOn(all.get(code)?.shift, day) ?? s.personShifts?.[code] ?? null;
  const chosen = (name ? list.find((x) => x.name.toUpperCase() === name.toUpperCase()) : undefined) ?? list[0];
  return { name: chosen.name, start: timeToMinutes(chosen.start), end: chosen.end ? timeToMinutes(chosen.end) : null };
}

/** Store of a person on a day (null = use the store on their staff account). */
export function storeOn(all: Assignments, userId: string, day: string): string | null {
  const v = valueOn(all.get(attendanceCode(userId))?.store, day);
  return v ? v.toUpperCase() : null;
}

/**
 * Store periods of a person inside one month: [{ store, from, to, days }]. One period when the person
 * didn't move that month. `fallback` is the store on the staff account (used before any store row).
 */
export function storePeriods(all: Assignments, userId: string, monthFrom: string, monthTo: string, fallback: string | null) {
  const list = all.get(attendanceCode(userId))?.store ?? [];
  const periods: { store: string | null; from: string; to: string; days: number }[] = [];
  const startStore = valueOn(list, monthFrom)?.toUpperCase() ?? (list.length ? list[0].value.toUpperCase() : fallback);
  let cur = { store: startStore, from: monthFrom };
  for (const a of list) {
    if (a.validFrom <= monthFrom || a.validFrom > monthTo) continue;
    const store = a.value.toUpperCase();
    if (store === cur.store) continue;
    periods.push({ ...cur, to: shiftDay(a.validFrom, -1), days: 0 });
    cur = { store, from: a.validFrom };
  }
  periods.push({ ...cur, to: monthTo, days: 0 });
  for (const p of periods) p.days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
  return periods;
}

function shiftDay(day: string, by: number) {
  return new Date(Date.parse(day) + by * 86_400_000).toISOString().slice(0, 10);
}

let lastApply = 0;

/**
 * A transfer whose date has come: put the new store on the staff account, so "Who's in",
 * store pages and alerts follow it. Runs from the minute jobs (at most every 10 minutes) and
 * right after a change is saved.
 */
export async function applyDueStores(force = false): Promise<number> {
  if (!force && Date.now() - lastApply < 10 * 60_000) return 0;
  lastApply = Date.now();
  const all = await loadAssignments(force);
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const { data } = await supabaseAdmin.from("staff_users").select("id, user_id, store_name");
  let n = 0;
  for (const s of (data ?? []) as { id: string; user_id: string; store_name: string | null }[]) {
    const want = storeOn(all, s.user_id, today);
    if (!want || want === String(s.store_name ?? "").toUpperCase()) continue;
    const { error } = await supabaseAdmin.from("staff_users").update({ store_name: want }).eq("id", s.id);
    if (!error) n++;
  }
  return n;
}

// ------------------------------------------------------------------
// Import from eTimeTrackLite's "Employee Shift" Excel report
// ------------------------------------------------------------------

export type ShiftDef = { name: string; start: string; end?: string };

const hhmm = (t: string) => {
  const m = String(t).trim().match(/^(\d{1,2})[.:](\d{2})$/);
  if (!m) return null;
  let h = Number(m[1]);
  let min = Number(m[2]);
  // "11.59" in eTimeTrackLite means noon.
  if (min === 59) {
    min = 0;
    h += 1;
  }
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
};
const dmy = (t: string) => {
  const m = String(t).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : /^\d{4}-\d{2}-\d{2}$/.test(String(t).trim()) ? String(t).trim() : null;
};

/** Rows of the Excel → shifts and each person's shift with its "valid from". */
export function parseShiftReport(rows: string[][]) {
  const head = rows.findIndex((r) => r.some((c) => /employee code/i.test(c)));
  if (head < 0) throw new Error("This doesn't look like the Employee Shift report (no 'Employee Code' column).");
  const h = rows[head].map((c) => c.trim().toLowerCase());
  const col = (re: RegExp) => h.findIndex((c) => re.test(c));
  const cCode = col(/^employee code$/);
  const cName = col(/^employee$/);
  const cShift = col(/shift code/) >= 0 ? col(/shift code/) : col(/shift name/);
  const cStart = col(/^start time$/);
  const cEnd = col(/^end time$/);
  const cFrom = col(/^valid from$/);
  if ([cCode, cShift, cStart, cFrom].some((i) => i < 0)) throw new Error("Missing a column: Employee Code, Shift, Start Time or Valid From.");
  const shifts = new Map<string, ShiftDef>();
  const people: { userId: string; name: string; shift: string; validFrom: string }[] = [];
  const skipped: string[] = [];
  for (const r of rows.slice(head + 1)) {
    const code = attendanceCode(r[cCode] ?? "");
    if (!code) continue;
    const shift = String(r[cShift] ?? "").split("(")[0].trim().toUpperCase().replace(/\s+/g, " ");
    const start = hhmm(r[cStart] ?? "");
    const end = cEnd >= 0 ? hhmm(r[cEnd] ?? "") : null;
    const from = dmy(r[cFrom] ?? "");
    const name = String(r[cName] ?? "").replace(/\s+/g, " ").trim();
    if (!shift || !start || !from) {
      skipped.push(name || code);
      continue;
    }
    if (!shifts.has(shift)) shifts.set(shift, { name: shift, start, ...(end ? { end } : {}) });
    people.push({ userId: code, name, shift, validFrom: from });
  }
  const list = [...shifts.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return { shifts: list, people, skipped };
}
