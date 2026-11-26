// Automatic letters (server only): reminders, warnings, PIP, final warning and termination,
// decided every morning from Care's records.
//
//  (All the numbers below are the defaults; the Super Admin changes them in Automatic letters → Rules.)
//  - SOP (Store Manager): 3 deviations at the store in 30 days that the Director has not approved
//    by 11 am the next day → warning letter to the Store Manager. The count restarts after each letter.
//  - Late coming (calendar month): 3 late days in a row, or more than 45 minutes late in all →
//    a polite reminder the first time; when it happens again in the same or the next month → warning.
//  - Sales performance: below 60% of target for 3 months in a row → PIP for 60 days; not improved →
//    second warning (30 days); not improved → final warning; not improved → termination.
//    The final warning and the termination letter are prepared and wait for the Super Admin to send them.
//
// The Super Admin switches the rules on / off and chooses who else (HR Executive, Store Manager)
// may pause, resume or reset a person (Warning letters → Automatic letters).

import { supabaseAdmin } from "@/lib/supabase/server";
import type { StaffUser } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { attendanceCode } from "@/lib/attendance";
import { formatDate } from "@/lib/helpers";
import { istNow } from "@/lib/business-day";
import { pushToStaff } from "@/lib/push";
import { siteUrl } from "@/lib/notify";
import { docName, type LetterKind } from "@/lib/letter-kinds";
import type { Letter } from "@/lib/warning-letters";

export type Track = "sop_sm" | "late" | "performance" | "plans" | "walkins";
export const TRACKS: Record<Track, string> = {
  sop_sm: "SOP (Store Manager)",
  late: "Late coming",
  performance: "Sales performance",
  plans: "Action plans (Store Manager)",
  walkins: "Walk-in counter (Store Manager)",
};
const isTrack = (t: unknown): t is Track => typeof t === "string" && t in TRACKS;

// ------------------------------------------------------------------
// Settings
// ------------------------------------------------------------------

const KEY = "discipline";
/** Counting starts on this day (no letters for what happened before the rules went live). */
const GO_LIVE = "2026-11-26";

export type DisciplineSettings = {
  rules: {
    /** count deviations within days → warning to the SM. */
    sop_sm: { on: boolean; from: string; count: number; days: number };
    /** run late days in a row, or more than minutes late in all, in a calendar month. */
    late: { on: boolean; from: string; run: number; minutes: number };
    /** from: first month (YYYY-MM) that counts; threshold: % of target below which a month is poor; months in a row → PIP. */
    performance: { on: boolean; from: string; threshold: number; months: number; pipDays: number; stepDays: number };
    /** High points Open openDays after they appear, or In progress with no update for progressDays; count of them in a month. */
    plans: { on: boolean; from: string; openDays: number; progressDays: number; count: number };
    /** Bills made with no walk-in counted in the gapMinutes before; count of such days in a month. */
    walkins: { on: boolean; from: string; gapMinutes: number; count: number };
  };
  /** Staff id whose name and signature go on the automatic letters (default: the Super Admin). */
  signer: string | null;
  /** HR Executives / Store Managers the Super Admin allowed to pause, resume and reset (SM: own store). */
  controllers: string[];
};

export const DEFAULT_SETTINGS: DisciplineSettings = {
  rules: {
    sop_sm: { on: true, from: GO_LIVE, count: 3, days: 30 },
    late: { on: true, from: GO_LIVE, run: 3, minutes: 45 },
    performance: { on: true, from: "2026-12", threshold: 60, months: 3, pipDays: 60, stepDays: 30 },
    plans: { on: true, from: GO_LIVE, openDays: 3, progressDays: 7, count: 3 },
    walkins: { on: true, from: GO_LIVE, gapMinutes: 120, count: 3 },
  },
  signer: null,
  controllers: [],
};

/** Limits of each number (Settings): [lowest, highest]. */
export const LIMITS = {
  sop_sm: { count: [1, 20], days: [7, 90] },
  late: { run: [2, 10], minutes: [10, 300] },
  performance: { threshold: [1, 100], months: [1, 6], pipDays: [15, 180], stepDays: [7, 90] },
  plans: { openDays: [1, 14], progressDays: [2, 30], count: [1, 20] },
  walkins: { gapMinutes: [30, 360], count: [1, 20] },
} as const;

const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m);

/** Cleans a rule's saved values: on / from / numbers within their limits (else the default). */
function cleanRule<T extends keyof DisciplineSettings["rules"]>(k: T, v: unknown): DisciplineSettings["rules"][T] {
  const d = DEFAULT_SETTINGS.rules[k] as Record<string, unknown>;
  const r = (v ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { on: typeof r.on === "boolean" ? r.on : d.on, from: (k === "performance" ? isMonth(r.from) : isDay(r.from)) ? r.from : d.from };
  for (const [name, [lo, hi]] of Object.entries(LIMITS[k] as Record<string, readonly [number, number]>)) {
    const n = Math.round(Number(r[name]));
    out[name] = Number.isFinite(n) && n >= lo && n <= hi ? n : d[name];
  }
  return out as DisciplineSettings["rules"][T];
}

export function cleanSettings(v: Partial<DisciplineSettings> | null | undefined): DisciplineSettings {
  const r = (v?.rules ?? {}) as Partial<DisciplineSettings["rules"]>;
  return {
    rules: {
      sop_sm: cleanRule("sop_sm", r.sop_sm),
      late: cleanRule("late", r.late),
      performance: cleanRule("performance", r.performance),
      plans: cleanRule("plans", r.plans),
      walkins: cleanRule("walkins", r.walkins),
    },
    signer: typeof v?.signer === "string" && v.signer ? v.signer : null,
    controllers: Array.isArray(v?.controllers) ? [...new Set(v.controllers.filter((x): x is string => typeof x === "string"))].slice(0, 50) : [],
  };
}

export async function loadDisciplineSettings(): Promise<DisciplineSettings> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  return cleanSettings((data?.value ?? {}) as Partial<DisciplineSettings>);
}

export async function saveDisciplineSettings(s: DisciplineSettings) {
  const { error } = await supabaseAdmin.from("app_settings").upsert({ key: KEY, value: s, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** Can this person use the controls? Super Admin always; HR Executive / SM when the Super Admin allowed it. */
export function canControl(me: StaffUser, s: DisciplineSettings) {
  if (me.role === "super_admin") return true;
  return (me.role === "hr_executive" || me.role === "store_manager" || me.role === "hr_head") && s.controllers.includes(me.id);
}
/** Stores whose people this controller manages (null = all). */
export const controlStores = (me: StaffUser): string[] | null => (me.role === "store_manager" ? (me.storeName ? [me.storeName.toUpperCase()] : []) : null);

// ------------------------------------------------------------------
// Cases (one per person per rule)
// ------------------------------------------------------------------

export type CaseData = {
  /** SOP / late: incidents up to this day are counted already. */
  countedUntil?: string;
  /** Late: month (YYYY-MM) and kind of the last letter. */
  lastActionMonth?: string;
  lastKind?: string;
  /** Performance: first month that counts for a new plan. */
  since?: string;
  /** Performance: day the current stage began, day it is reviewed. */
  stageFrom?: string;
  reviewOn?: string;
  /** Letters of the current performance case (for the references in the next letter). */
  refs?: { kind: string; number: string | null; date: string }[];
  letters?: number;
};

export type DisciplineCase = {
  id: string;
  staff_id: string;
  user_id: string;
  staff_name: string;
  store: string | null;
  track: Track;
  stage: string;
  status: "active" | "paused";
  data: CaseData;
  note: string | null;
  paused_by: string | null;
  last_action_at: string | null;
  updated_at: string;
};

export type CaseEvent = {
  id: string;
  case_id: string;
  at: string;
  action: string;
  letter_id: string | null;
  note: string | null;
  by_name: string | null;
};

export const STAGES: Record<string, string> = {
  watching: "Watching",
  reminded: "Reminder sent",
  warned: "Warning sent",
  pip: "On PIP",
  second: "Second warning",
  final_waiting: "Final warning waiting for the Super Admin",
  final: "Final warning",
  termination_waiting: "Termination letter waiting for the Super Admin",
  terminated: "Termination letter sent",
};

async function loadCases(): Promise<DisciplineCase[]> {
  const { data, error } = await supabaseAdmin.from("discipline_cases").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DisciplineCase[];
}

async function saveCase(c: Omit<DisciplineCase, "id" | "updated_at"> & { id?: string }): Promise<DisciplineCase> {
  const row = { ...c, updated_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin.from("discipline_cases").upsert(row, { onConflict: "staff_id,track" }).select("*").single();
  if (error) throw error;
  return data as DisciplineCase;
}

async function addEvent(caseId: string, action: string, note: string | null, letterId: string | null = null, by: string | null = null) {
  await supabaseAdmin.from("discipline_events").insert({
    case_id: caseId,
    action,
    note: note?.slice(0, 1000) ?? null,
    letter_id: letterId,
    by_name: by,
  });
}

// ------------------------------------------------------------------
// Dates
// ------------------------------------------------------------------

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthOf = (d: string) => d.slice(0, 7);
const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + n, 1));
  return t.toISOString().slice(0, 7);
};
const monthName = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const money = (n: number) => `Rs. ${Math.round(n).toLocaleString("en-IN")}`;
const maxDay = (...d: (string | undefined | null)[]) =>
  d
    .filter((x): x is string => Boolean(x))
    .sort()
    .pop()!;

// ------------------------------------------------------------------
// The daily run
// ------------------------------------------------------------------

type Person = {
  id: string;
  userId: string;
  name: string;
  store: string | null;
  role: Role;
};

/** One thing the run does (or, in a preview, would do). */
export type PlannedAction = {
  track: Track;
  staffId: string;
  userId: string;
  name: string;
  store: string | null;
  /** What happens: a letter (sent / waiting for the Super Admin) or only a change of stage. */
  what: string;
  kind?: LetterKind;
  needs?: "super_admin" | null;
  subject?: string;
  body?: string;
  /** The case as it will be after this action. */
  next: { stage: string; data: CaseData };
  event: string;
  existing: DisciplineCase | null;
};

const g = globalThis as unknown as {
  __syDisciplineDay?: string;
  __syDisciplineBusy?: boolean;
  __syDisciplineSending?: boolean;
};

/** Called every minute from the day jobs: runs once a day, after 11 am India time. */
export async function disciplineTick(): Promise<string> {
  const now = istNow();
  if (now.minutes < 11 * 60) return "not yet";
  if (g.__syDisciplineDay === now.date || g.__syDisciplineBusy) return "already";
  g.__syDisciplineBusy = true;
  try {
    const { error } = await supabaseAdmin.from("discipline_runs").insert({ day: now.date, started_at: new Date().toISOString() });
    if (error) {
      g.__syDisciplineDay = now.date; // already run today (another server) or the table is missing
      return /duplicate|23505/.test(`${error.code} ${error.message}`) ? "already" : `not set up: ${error.message}`;
    }
    g.__syDisciplineDay = now.date;
    const r = await runDiscipline({ dryRun: false });
    await supabaseAdmin
      .from("discipline_runs")
      .update({
        finished_at: new Date().toISOString(),
        result: r.summary.slice(0, 2000),
      })
      .eq("day", now.date);
    return r.summary;
  } finally {
    g.__syDisciplineBusy = false;
  }
}

/** Works out what is due today; with dryRun false, also sends the letters and moves the cases on. */
export async function runDiscipline({
  dryRun,
  by,
}: {
  dryRun: boolean;
  by?: string;
}): Promise<{ actions: PlannedAction[]; summary: string; errors: string[] }> {
  const settings = await loadDisciplineSettings();
  const cases = await loadCases();
  const caseOf = (staffId: string, track: Track) => cases.find((c) => c.staff_id === staffId && c.track === track) ?? null;
  const { data: staffRows } = await supabaseAdmin.from("staff_users").select("id, user_id, full_name, store_name, role").eq("is_active", true);
  const people: Person[] = (
    (staffRows ?? []) as {
      id: string;
      user_id: string;
      full_name: string;
      store_name: string | null;
      role: Role;
    }[]
  ).map((s) => ({
    id: s.id,
    userId: s.user_id,
    name: s.full_name,
    store: s.store_name ? s.store_name.toUpperCase() : null,
    role: s.role,
  }));
  const today = istNow().date;
  const yesterday = addDays(today, -1);
  const actions: PlannedAction[] = [];
  const errors: string[] = [];
  const tryTrack = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  if (settings.rules.sop_sm.on) await tryTrack("SOP", () => planSop(settings, people, caseOf, today, yesterday, actions));
  if (settings.rules.late.on) await tryTrack("Late coming", () => planLate(settings, people, caseOf, yesterday, actions));
  if (settings.rules.performance.on) await tryTrack("Performance", () => planPerformance(settings, people, caseOf, today, actions));
  if (settings.rules.plans.on) await tryTrack("Action plans", () => planPlans(settings, people, caseOf, today, yesterday, actions));
  if (settings.rules.walkins.on) await tryTrack("Walk-in counter", () => planWalkins(settings, people, caseOf, yesterday, actions));

  let done = 0;
  if (!dryRun) {
    if (g.__syDisciplineSending)
      return {
        actions,
        summary: "Another run is sending letters right now. Try again in a minute.",
        errors,
      };
    g.__syDisciplineSending = true;
  }
  try {
    if (!dryRun) {
      const signer = settings.signer ?? (await defaultSigner());
      for (const a of actions) {
        try {
          await applyAction(a, signer, by ?? "Automatic");
          done++;
        } catch (e) {
          errors.push(`${a.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  } finally {
    if (!dryRun) g.__syDisciplineSending = false;
  }
  const letters = actions.filter((a) => a.kind).length;
  const summary = dryRun
    ? `${actions.length} action(s) due (${letters} letter(s))${errors.length ? `; ${errors.length} problem(s)` : ""}`
    : `${done} of ${actions.length} action(s) done (${letters} letter(s))${errors.length ? `; problems: ${errors.join(" | ")}` : ""}`;
  return { actions, summary, errors };
}

async function defaultSigner(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("staff_users")
    .select("id")
    .eq("is_active", true)
    .eq("role", "super_admin")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function applyAction(a: PlannedAction, signer: string | null, by: string) {
  const { createAutoLetter } = await import("@/lib/warning-letters");
  const p = a.existing;
  let c = await saveCase({
    ...(p?.id ? { id: p.id } : {}),
    staff_id: a.staffId,
    user_id: a.userId,
    staff_name: a.name,
    store: a.store,
    track: a.track,
    stage: a.next.stage,
    status: p?.status ?? "active",
    data: a.next.data,
    note: p?.note ?? null,
    paused_by: p?.paused_by ?? null,
    last_action_at: new Date().toISOString(),
  });
  let letter: Letter | null = null;
  if (a.kind && a.subject && a.body) {
    if (!signer) throw new Error("No signer for the automatic letters (Settings).");
    letter = await createAutoLetter({
      staffId: a.staffId,
      kind: a.kind,
      subject: a.subject,
      body: a.body,
      rule: a.track,
      caseId: c.id,
      signerId: signer,
      needs: a.needs ?? null,
    });
    if (letter.status === "sent") {
      const refs = [
        ...(c.data.refs ?? []).slice(-9),
        {
          kind: a.kind,
          number: letter.number,
          date: (letter.sent_at ?? letter.created_at).slice(0, 10),
        },
      ];
      c = await saveCase({
        ...c,
        data: { ...c.data, refs, letters: (c.data.letters ?? 0) + 1 },
      });
    }
    await tellOffice(letter, a);
  }
  await addEvent(c.id, a.event, a.what, letter?.id ?? null, by);
}

/** HR and the Super Admin hear about each automatic letter. */
async function tellOffice(l: Letter, a: PlannedAction) {
  const { data } = await supabaseAdmin.from("staff_users").select("id, role").eq("is_active", true).in("role", ["super_admin", "hr_head", "hr_executive"]);
  const ids = ((data ?? []) as { id: string; role: Role }[]).map((s) => s.id).filter((id) => id !== l.staff_id);
  if (!ids.length || l.status !== "sent") return; // waiting letters: the Super Admin is told by notifyApprovers
  const title = `Automatic letter: ${docName(l.kind)} ${l.number ?? ""} to ${l.staff_name}`.replace(/\s+/g, " ");
  const body = `${a.what} (${l.store ?? ""})`;
  await supabaseAdmin.from("staff_notifications").insert(
    ids.map((staff_id) => ({
      staff_id,
      ticket_type: null,
      ticket_id: l.id,
      ticket_number: l.number,
      title,
      body,
    })),
  );
  await pushToStaff(ids, {
    title,
    body,
    url: `${siteUrl()}/staff/letters/${l.id}`,
  }).catch(() => undefined);
}

// ------------------------------------------------------------------
// SOP: warning to the Store Manager after 3 deviations in 30 days
// ------------------------------------------------------------------

async function planSop(
  s: DisciplineSettings,
  people: Person[],
  caseOf: (id: string, t: Track) => DisciplineCase | null,
  today: string,
  yesterday: string,
  out: PlannedAction[],
) {
  const { loadStaffForPerformance } = await import("@/lib/performance");
  const { sopIncidents, letterTemplate } = await import("@/lib/warning-letters");
  const sms = (await loadStaffForPerformance()).filter((p) => p.group === "sm" && p.store);
  for (const sm of sms) {
    const person = people.find((p) => p.id === sm.id);
    if (!person) continue;
    const c = caseOf(sm.id, "sop_sm");
    if (c?.status === "paused") continue;
    const from = maxDay(s.rules.sop_sm.from, c?.data.countedUntil ? addDays(c.data.countedUntil, 1) : null, addDays(today, -s.rules.sop_sm.days));
    if (from > yesterday) continue;
    const items = await sopIncidents(sm.store, null, from, yesterday);
    if (items.length < s.rules.sop_sm.count) continue;
    const t = await letterTemplate("sop", { id: sm.id, userId: sm.userId, name: person.name, store: sm.store }, undefined, {
      from,
      to: yesterday,
      ref: `This is the ${ordinal((c?.data.letters ?? 0) + 1)} letter about the opening / closing SOP: ${items.length} deviations at ${sm.store} since ${formatDate(from)} were not approved by the Director.`,
    });
    out.push({
      track: "sop_sm",
      staffId: sm.id,
      userId: person.userId,
      name: person.name,
      store: sm.store,
      what: `${items.length} SOP deviations at ${sm.store} (${formatDate(from)} – ${formatDate(yesterday)}): warning letter to the Store Manager`,
      kind: "sop",
      subject: t.subject,
      body: t.body,
      next: {
        stage: "warned",
        data: { ...(c?.data ?? {}), countedUntil: yesterday },
      },
      event: "sop_warning",
      existing: c,
    });
  }
}

const ordinal = (n: number) => (n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : `${n}th`);

// ------------------------------------------------------------------
// Late coming: reminder, then warning (calendar month)
// ------------------------------------------------------------------

async function planLate(
  s: DisciplineSettings,
  people: Person[],
  caseOf: (id: string, t: Track) => DisciplineCase | null,
  yesterday: string,
  out: PlannedAction[],
) {
  const [{ dutyDays }, { loadMonthPunches }, { loadAssignments, shiftOn, storeOn }, { loadPerformanceSettings }, { lateTime }, { letterTemplate }] =
    await Promise.all([
      import("@/lib/duties"),
      import("@/lib/attendance-days"),
      import("@/lib/assignments"),
      import("@/lib/performance-settings"),
      import("@/lib/performance-rules"),
      import("@/lib/warning-letters"),
    ]);
  const month = monthOf(yesterday);
  const [settings, assignments, index] = await Promise.all([loadPerformanceSettings(), loadAssignments(), loadMonthPunches(month)]);
  const skip: Role[] = ["super_admin", "director"];
  for (const person of people) {
    if (skip.includes(person.role) || !attendanceCode(person.userId)) continue;
    const c = caseOf(person.id, "late");
    if (c?.status === "paused") continue;
    const from = maxDay(s.rules.late.from, `${month}-01`, c?.data.countedUntil ? addDays(c.data.countedUntil, 1) : null);
    if (from > yesterday) continue;
    const days = await dutyDays(person.userId, month, {
      shift: (day) => shiftOn(settings, assignments, person.userId, day),
      grace: settings.lateGraceMinutes,
      store: (day) => storeOn(assignments, person.userId, day) ?? person.store,
      index,
    });
    // Worked days (a punch) in order; late ones break or extend the run of late days.
    let run = 0;
    let total = 0;
    let hit: { day: string; why: string } | null = null;
    for (const d of days) {
      if (d.date < from || d.date > yesterday || d.status !== "present") continue;
      if (d.late && !d.justification) {
        run++;
        total += d.late;
      } else run = 0;
      if (run >= s.rules.late.run) hit = { day: d.date, why: `${run} late days in a row` };
      else if (total > s.rules.late.minutes) hit = { day: d.date, why: `${lateTime(total)} late in all` };
      if (hit) break;
    }
    if (!hit) continue;
    const repeat = c?.data.lastActionMonth === month || c?.data.lastActionMonth === addMonths(month, -1);
    const kind: LetterKind = repeat ? "attendance" : "reminder";
    const prev = c?.data.refs
      ?.slice()
      .reverse()
      .find((r) => r.kind === "reminder" || r.kind === "attendance");
    const t = await letterTemplate(
      kind,
      {
        id: person.id,
        userId: person.userId,
        name: person.name,
        store: person.store,
      },
      month,
      {
        from,
        to: hit.day,
        lateOnly: true,
        ref:
          repeat && prev
            ? `You were sent ${prev.kind === "reminder" ? "a reminder" : "a warning letter"} (${prev.number ?? ""}, ${formatDate(prev.date)}) about late coming, and it has happened again.`
            : undefined,
      },
    );
    out.push({
      track: "late",
      staffId: person.id,
      userId: person.userId,
      name: person.name,
      store: person.store,
      what: `${hit.why} (${formatDate(from)} – ${formatDate(hit.day)}): ${repeat ? "warning letter" : "reminder"}`,
      kind,
      subject: t.subject,
      body: t.body,
      next: {
        stage: repeat ? "warned" : "reminded",
        data: {
          ...(c?.data ?? {}),
          countedUntil: hit.day,
          lastActionMonth: month,
          lastKind: kind,
        },
      },
      event: repeat ? "late_warning" : "late_reminder",
      existing: c,
    });
  }
}

// ------------------------------------------------------------------
// Action plans and the walk-in counter: reminder, then warning to the Store Manager
// ------------------------------------------------------------------

type Lapse = { day: string; line: string };

/** 'count' lapses after the last letter in the month → reminder; again in the same or the next month → warning. */
function stepLetter(
  track: "plans" | "walkins",
  count: number,
  c: DisciplineCase | null,
  sm: { id: string; userId: string; name: string; store: string },
  month: string,
  upTo: string,
  lapses: Lapse[],
  text: { what: string; subject: [string, string]; intro: string; ask: string },
  out: PlannedAction[]
) {
  if (lapses.length < count) return;
  const repeat = c?.data.lastActionMonth === month || c?.data.lastActionMonth === addMonths(month, -1);
  const prev = c?.data.refs
    ?.slice()
    .reverse()
    .find((r) => r.kind === "reminder" || r.kind === "other");
  const first = sm.name.split(" ")[0];
  const lines = lapses
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((l) => l.line)
    .join("\n");
  const ref = repeat && prev ? `You were sent ${prev.kind === "reminder" ? "a reminder" : "a warning letter"} (${prev.number ?? ""}, ${formatDate(prev.date)}) about this, and it has happened again.\n\n` : "";
  out.push({
    track,
    staffId: sm.id,
    userId: sm.userId,
    name: sm.name,
    store: sm.store,
    what: `${lapses.length} × ${text.what}: ${repeat ? "warning letter" : "reminder"} to the Store Manager`,
    kind: repeat ? "other" : "reminder",
    subject: repeat ? text.subject[1] : text.subject[0],
    body: repeat
      ? `Dear ${first},\n\n${ref}${text.intro}\n\n${lines}\n\n${text.ask}\n\nYou are instructed to correct this immediately. Any repetition will lead to stricter disciplinary action as per company policy.`
      : `Dear ${first},\n\nThis is a reminder. ${text.intro}\n\n${lines}\n\n${text.ask}\n\nPlease note that if this continues, a warning letter will be issued as per company policy.`,
    next: { stage: repeat ? "warned" : "reminded", data: { ...(c?.data ?? {}), countedUntil: upTo, lastActionMonth: month, lastKind: repeat ? "other" : "reminder" } },
    event: repeat ? `${track}_warning` : `${track}_reminder`,
    existing: c,
  });
}

/** IST day of a timestamp. */
const istDay = (t: string) => new Date(Date.parse(t) + 5.5 * 3_600_000).toISOString().slice(0, 10);
/** Minutes after midnight (IST) of a timestamp. */
const istMinutes = (t: string) => {
  const d = new Date(Date.parse(t) + 5.5 * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const clock = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

async function storeManagers(people: Person[]) {
  const { loadStaffForPerformance } = await import("@/lib/performance");
  return (await loadStaffForPerformance())
    .filter((p) => p.group === "sm" && p.store)
    .map((p) => people.find((x) => x.id === p.id) && { id: p.id, userId: p.userId, name: people.find((x) => x.id === p.id)!.name, store: String(p.store).toUpperCase() })
    .filter((x): x is { id: string; userId: string; name: string; store: string } => Boolean(x));
}

async function planPlans(s: DisciplineSettings, people: Person[], caseOf: (id: string, t: Track) => DisciplineCase | null, today: string, yesterday: string, out: PlannedAction[]) {
  const R = s.rules.plans;
  const [{ monthReport, storeTrends, storePreviousPeriod }, { actionPlans, planView }, { storePace }, { loadPerformanceSettings }] = await Promise.all([
    import("@/lib/performance"),
    import("@/lib/action-plans"),
    import("@/lib/store-pace"),
    import("@/lib/performance-settings"),
  ]);
  const month = monthOf(today);
  const [report, ps, sms] = await Promise.all([monthReport(month), loadPerformanceSettings(), storeManagers(people)]);
  for (const sm of sms) {
    const store = report.stores.find((x) => x.store.toUpperCase() === sm.store);
    if (!store) continue;
    const c = caseOf(sm.id, "plans");
    const trends = await storeTrends(month, store.store).catch(() => null);
    if (!trends) continue;
    const prev = await storePreviousPeriod(month, store.store, storePace(store).done).catch(() => null);
    const points = actionPlans(store, trends, prev, ps.asmIsFm).flatMap((pl) =>
      pl.items.filter((it) => it.priority === "high").map((it) => ({ label: pl.label, view: planView(pl.role, it) }))
    );
    // When each point was first shown (kept so "Open for 3 days" can be counted).
    if (points.length) {
      await supabaseAdmin
        .from("action_plan_seen")
        .upsert(
          points.map((p) => ({ store: store.store, month, key: p.view.key, title: p.view.observation.slice(0, 200), first_seen: today })),
          { onConflict: "store,month,key", ignoreDuplicates: true }
        );
    }
    if (c?.status === "paused") continue;
    const [{ data: seenRows }, { data: followRows }] = await Promise.all([
      supabaseAdmin.from("action_plan_seen").select("key, first_seen").eq("store", store.store).eq("month", month),
      supabaseAdmin.from("action_plan_follow").select("key, status, updated_at").eq("store", store.store).eq("month", month),
    ]);
    const seen = new Map(((seenRows ?? []) as { key: string; first_seen: string }[]).map((r) => [r.key, r.first_seen]));
    const follow = new Map(((followRows ?? []) as { key: string; status: string; updated_at: string }[]).map((r) => [r.key, r]));
    const from = maxDay(R.from, `${month}-01`, c?.data.countedUntil ? addDays(c.data.countedUntil, 1) : null);
    const lapses: Lapse[] = [];
    for (const p of points) {
      const shown = seen.get(p.view.key) ?? today;
      const f = follow.get(p.view.key);
      let due: string | null = null;
      let why = "";
      if (!f || f.status === "open") {
        due = addDays(maxDay(shown, f ? istDay(f.updated_at) : null), R.openDays);
        why = `still Open, with no update after ${R.openDays} day${R.openDays === 1 ? "" : "s"}`;
      } else if (f.status === "in_progress") {
        due = addDays(istDay(f.updated_at), R.progressDays);
        why = `In progress, with no update since ${formatDate(istDay(f.updated_at))}`;
      }
      if (!due || due < from || due > yesterday) continue;
      lapses.push({ day: due, line: `- "${p.view.observation}" (${p.label} point, shown since ${formatDate(shown)}): ${why}.` });
    }
    stepLetter(
      "plans",
      R.count,
      c,
      sm,
      month,
      yesterday,
      lapses,
      {
        what: `high-priority action plan point(s) at ${sm.store} not updated`,
        subject: ["Reminder: action plan points not updated", "Warning for not acting on the store's action plans"],
        intro: `As the Store Manager of ${sm.store}, you are responsible for making sure every high-priority point in the store's action plans (Seven Years Care → Performance → Action plans) is acted on and its status kept up to date. The following points have not been updated:`,
        ask: "Review each point with your team today, act on it, and update its status (In progress / Done / Not relevant) with a short note on what was done.",
      },
      out
    );
  }
}

async function planWalkins(s: DisciplineSettings, people: Person[], caseOf: (id: string, t: Track) => DisciplineCase | null, yesterday: string, out: PlannedAction[]) {
  const R = s.rules.walkins;
  const [{ loadPerformanceSettings }, { hoursOf, isSpecialDay }, { timeToMinutes }] = await Promise.all([
    import("@/lib/performance-settings"),
    import("@/lib/business-day"),
    import("@/lib/performance-rules"),
  ]);
  const month = monthOf(yesterday);
  const [ps, sms] = await Promise.all([loadPerformanceSettings(), storeManagers(people)]);
  for (const sm of sms) {
    const c = caseOf(sm.id, "walkins");
    if (c?.status === "paused") continue;
    const from = maxDay(R.from, `${month}-01`, c?.data.countedUntil ? addDays(c.data.countedUntil, 1) : null);
    if (from > yesterday) continue;
    const [{ data: ev }, { data: bills }] = await Promise.all([
      supabaseAdmin.from("walkin_events").select("day, at, delta").eq("store", sm.store).gte("day", from).lte("day", yesterday).gt("delta", 0).limit(20000),
      supabaseAdmin
        .from("sales_invoices")
        .select("invoice_date, billed_at, status")
        .ilike("store", sm.store)
        .gte("invoice_date", from)
        .lte("invoice_date", yesterday)
        .not("billed_at", "is", null)
        .limit(20000),
    ]);
    const presses = new Map<string, number[]>();
    for (const e of (ev ?? []) as { day: string; at: string }[]) presses.set(e.day, [...(presses.get(e.day) ?? []), istMinutes(e.at)]);
    const billTimes = new Map<string, number[]>();
    for (const b of (bills ?? []) as { invoice_date: string; billed_at: string; status: string | null }[]) {
      if (/void|draft/i.test(b.status ?? "")) continue;
      billTimes.set(b.invoice_date, [...(billTimes.get(b.invoice_date) ?? []), istMinutes(b.billed_at)]);
    }
    const h = hoursOf(ps, sm.store);
    const open = timeToMinutes(h.open) || 9 * 60 + 30;
    const close = timeToMinutes(h.close) || 22 * 60;
    const lapses: Lapse[] = [];
    for (let d = from; d <= yesterday; d = addDays(d, 1)) {
      if (isSpecialDay(ps, sm.store, d)) continue;
      const ps_ = (presses.get(d) ?? []).sort((a, b) => a - b);
      const bs = (billTimes.get(d) ?? []).filter((t) => t >= open && t <= close + 30).sort((a, b) => a - b);
      if (!bs.length) continue;
      // A bill with no walk-in counted in the gap before it (from the last press, or from opening).
      const gaps = new Map<number, { to: number; bills: number }>();
      for (const t of bs) {
        const last = ps_.filter((p) => p <= t).pop() ?? open;
        if (t - last < R.gapMinutes) continue;
        const g = gaps.get(last);
        gaps.set(last, { to: Math.max(g?.to ?? 0, t), bills: (g?.bills ?? 0) + 1 });
      }
      if (!gaps.size) continue;
      const parts = [...gaps.entries()].map(([a, g]) => `from ${clock(a)} to ${clock(g.to)} (${g.bills} bill${g.bills === 1 ? "" : "s"} made)`);
      lapses.push({ day: d, line: `- ${formatDate(d)}: no walk-in counted ${parts.join("; ")}${ps_.length ? "" : " — the counter was not used that day"}.` });
    }
    stepLetter(
      "walkins",
      R.count,
      c,
      sm,
      month,
      yesterday,
      lapses,
      {
        what: `day(s) with the walk-in counter not updated at ${sm.store}`,
        subject: ["Reminder: walk-in counter not updated", "Warning for not updating the walk-in counter"],
        intro: `As the Store Manager of ${sm.store}, you are responsible for making sure the walk-in counter in Seven Years Care is updated as customers come in, so that the store's conversion can be measured. On the following days, bills were made but no walk-in was counted for ${R.gapMinutes % 60 === 0 ? `${R.gapMinutes / 60} hour${R.gapMinutes === 60 ? "" : "s"}` : `${R.gapMinutes} minutes`} or more before them:`,
        ask: "Make sure the CRE (or whoever is at the counter) presses the walk-in counter for every customer who walks in, all through the day.",
      },
      out
    );
  }
}

// ------------------------------------------------------------------
// Sales performance: PIP → second warning → final warning → termination
// ------------------------------------------------------------------

type Ach = { net: number; target: number; pct: number };

async function planPerformance(
  s: DisciplineSettings,
  people: Person[],
  caseOf: (id: string, t: Track) => DisciplineCase | null,
  today: string,
  out: PlannedAction[],
) {
  const { monthReport } = await import("@/lib/performance");
  const threshold = s.rules.performance.threshold / 100;
  // Months are judged once complete (from the 2nd of the next month, when the last bills are in).
  const lastComplete = addMonths(monthOf(today), Number(today.slice(8, 10)) >= 2 ? -1 : -2);
  const reports = new Map<string, Map<string, Ach>>();
  const achOf = async (m: string) => {
    if (!reports.has(m)) {
      const r = await monthReport(m);
      const map = new Map<string, Ach>();
      for (const p of r.stores.flatMap((x) => x.people)) {
        if (!p.targetApplies || !p.target || p.target <= 0) continue;
        const k = attendanceCode(p.userId);
        const cur = map.get(k) ?? { net: 0, target: 0, pct: 0 };
        cur.net += p.net;
        cur.target += p.target;
        cur.pct = cur.target ? cur.net / cur.target : 0;
        map.set(k, cur);
      }
      reports.set(m, map);
    }
    return reports.get(m)!;
  };
  const line = (m: string, a: Ach) => `- ${monthName(m)}: ${money(a.net)} against the target of ${money(a.target)} (${Math.round(a.pct * 100)}%)`;
  const latest = await achOf(lastComplete);

  for (const person of people) {
    const code = attendanceCode(person.userId);
    const c = caseOf(person.id, "performance");
    if (c?.status === "paused") continue;
    const stage = c?.stage ?? "watching";
    const data = c?.data ?? {};
    const base = {
      track: "performance" as const,
      staffId: person.id,
      userId: person.userId,
      name: person.name,
      store: person.store,
      existing: c,
    };

    if (stage === "watching") {
      if (!latest.get(code)) continue;
      const since = [s.rules.performance.from, data.since ?? ""].sort().pop()!;
      const P = s.rules.performance;
      const months = Array.from({ length: P.months }, (_, i) => addMonths(lastComplete, i - P.months + 1));
      if (months[0] < since) continue;
      const achs = await Promise.all(months.map(async (m) => (await achOf(m)).get(code)));
      if (!achs.every((a) => a && a.pct < threshold)) continue;
      const end = addDays(today, P.pipDays);
      const first = person.name.split(" ")[0];
      out.push({
        ...base,
        what: `Below ${s.rules.performance.threshold}% of target in ${months.map(monthName).join(", ")}: PIP for ${P.pipDays} days`,
        kind: "pip",
        subject: `Performance Improvement Plan (PIP) from ${formatDate(today)} to ${formatDate(end)}`,
        body: `Dear ${first},\n\nYour sales achievement has been below ${s.rules.performance.threshold}% of your target for ${P.months === 1 ? "the last month" : `the last ${P.months} months`}:\n\n${months.map((m, i) => line(m, achs[i]!)).join("\n")}\n\nYou are therefore placed on a Performance Improvement Plan (PIP) for ${P.pipDays} days, from ${formatDate(today)} to ${formatDate(end)}. During this period you are expected to:\n\n- reach at least ${s.rules.performance.threshold}% of your monthly sales target;\n- follow your Store Manager's guidance on selling, customer approach and product knowledge;\n- review your progress with your Store Manager every week.\n\nThe management will support you with guidance and training. Your performance will be reviewed at the end of the plan, on ${formatDate(end)}. If it has not improved, further disciplinary action will be taken as per company policy.`,
        next: {
          stage: "pip",
          data: {
            since: data.since,
            stageFrom: today,
            reviewOn: end,
            refs: [],
          },
        },
        event: "pip",
      });
      continue;
    }

    if (!["pip", "second", "final"].includes(stage) || !data.reviewOn || today < data.reviewOn || !data.stageFrom) continue;
    // Months of the stage (the 15th inside it); wait until the last of them is complete.
    const months: string[] = [];
    for (let m = monthOf(data.stageFrom); `${m}-15` < data.reviewOn; m = addMonths(m, 1)) if (`${m}-15` >= data.stageFrom) months.push(m);
    if (!months.length || months[months.length - 1] > lastComplete) continue; // check again tomorrow
    const achs = await Promise.all(months.map(async (m) => (await achOf(m)).get(code)));
    const last = achs[achs.length - 1];
    if (!last) continue; // no target this month (e.g. moved): wait
    const lines = months.map((m, i) => (achs[i] ? line(m, achs[i]!) : `- ${monthName(m)}: no target`)).join("\n");
    if (last.pct >= threshold) {
      out.push({
        ...base,
        what: `${monthName(months[months.length - 1])}: ${Math.round(last.pct * 100)}% of target — improved, case closed`,
        next: {
          stage: "watching",
          data: { since: addMonths(lastComplete, 1) },
        },
        event: "improved",
      });
      continue;
    }
    const refs = data.refs ?? [];
    const refText = refs.map((r) => `${docName(r.kind)} ${r.number ?? ""} dated ${formatDate(r.date)}`.replace(/\s+/g, " ")).join("; ");
    const first = person.name.split(" ")[0];
    const tail = "\n\nYou are instructed to improve immediately. The management will continue to support you with guidance and training.";
    if (stage === "pip") {
      const end = addDays(today, s.rules.performance.stepDays);
      out.push({
        ...base,
        what: `Not improved after the PIP (${Math.round(last.pct * 100)}% in ${monthName(months[months.length - 1])}): second warning`,
        kind: "second",
        subject: "Second warning: sales performance not improved after the PIP",
        body: `Dear ${first},\n\nReference: ${refText || "Performance Improvement Plan"}.\n\nYou were placed on a Performance Improvement Plan because your sales were below ${s.rules.performance.threshold}% of your target. During the plan, your performance has not improved:\n\n${lines}\n\nThis is your second warning. You must reach at least ${s.rules.performance.threshold}% of your target. Your performance will be reviewed again on ${formatDate(end)}. If it has not improved by then, a final warning letter will be issued.${tail}`,
        next: {
          stage: "second",
          data: { ...data, stageFrom: today, reviewOn: end },
        },
        event: "second_warning",
      });
    } else if (stage === "second") {
      out.push({
        ...base,
        what: `Not improved after the second warning (${Math.round(last.pct * 100)}%): final warning prepared for the Super Admin`,
        kind: "final",
        needs: "super_admin",
        subject: "Final warning: sales performance",
        body: `Dear ${first},\n\nReference: ${refText}.\n\nDespite the Performance Improvement Plan and the second warning, your sales performance has not improved:\n\n${lines}\n\nThis is your final warning. If your sales do not reach at least ${s.rules.performance.threshold}% of your target within ${s.rules.performance.stepDays} days of this letter, your employment with Seven Years Kids Care LLP may be terminated as per company policy.${tail}`,
        next: { stage: "final_waiting", data: { ...data } },
        event: "final_prepared",
      });
    } else if (stage === "final") {
      out.push({
        ...base,
        what: `Not improved after the final warning (${Math.round(last.pct * 100)}%): termination letter prepared for the Super Admin`,
        kind: "termination",
        needs: "super_admin",
        subject: "Termination of employment",
        body: `Dear ${first},\n\nReference: ${refText}.\n\nDespite the Performance Improvement Plan, the second warning and the final warning, your sales performance has remained below ${s.rules.performance.threshold}% of your target:\n\n${lines}\n\nThe management has therefore decided to terminate your employment with Seven Years Kids Care LLP. Your last working day will be [last working day].\n\nPlease hand over the company's property, keys, uniform and documents to your Store Manager on or before your last working day. Your final settlement will be processed as per company policy.\n\nWe thank you for your service and wish you well for the future.`,
        next: { stage: "termination_waiting", data: { ...data } },
        event: "termination_prepared",
      });
    }
  }
}

/** A letter of a case was sent / not approved / revoked by a person: move the case on. */
export async function onLetterDecided(l: Letter, what: "sent" | "rejected" | "revoked", by: string) {
  if (!l.case_id) return;
  const { data } = await supabaseAdmin.from("discipline_cases").select("*").eq("id", l.case_id).maybeSingle();
  const c = data as DisciplineCase | null;
  if (!c) return;
  const today = istNow().date;
  const ref = {
    kind: l.kind,
    number: l.number,
    date: (l.sent_at ?? l.created_at).slice(0, 10),
  };
  let next: Partial<DisciplineCase> | null = null;
  let note = "";
  const stepDays = (await loadDisciplineSettings()).rules.performance.stepDays;
  if (what === "sent" && l.kind === "final" && c.stage === "final_waiting") {
    next = {
      stage: "final",
      data: {
        ...c.data,
        stageFrom: today,
        reviewOn: addDays(today, stepDays),
        refs: [...(c.data.refs ?? []), ref],
      },
    };
    note = `Final warning ${l.number} sent by ${by}; review on ${formatDate(addDays(today, stepDays))}`;
  } else if (what === "sent" && l.kind === "termination") {
    next = {
      stage: "terminated",
      status: "paused",
      data: { ...c.data, refs: [...(c.data.refs ?? []), ref] },
    };
    note = `Termination letter ${l.number} sent by ${by}`;
  } else if (what === "sent") {
    next = { data: { ...c.data, refs: [...(c.data.refs ?? []), ref] } };
    note = `${docName(l.kind)} ${l.number} sent by ${by}`;
  } else if (what === "rejected" && (l.kind === "final" || l.kind === "termination")) {
    // Not sent: the plan ends; a new one starts only after 3 new poor months.
    next = { stage: "watching", data: { since: addMonths(monthOf(today), 0) } };
    note = `${docName(l.kind)} not sent by ${by}: case closed`;
  } else if (what === "revoked") {
    next = {
      status: "paused",
      note: `Paused: ${docName(l.kind)} ${l.number ?? ""} revoked by ${by}`,
    };
    note = `${docName(l.kind)} ${l.number ?? ""} revoked by ${by}: case paused`;
  }
  if (!next) return;
  await supabaseAdmin
    .from("discipline_cases")
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq("id", c.id);
  await addEvent(c.id, `letter_${what}`, note, l.id, by);
}

// ------------------------------------------------------------------
// Manual controls
// ------------------------------------------------------------------

export async function controlCase(
  me: StaffUser,
  input: {
    action: "pause" | "resume" | "reset";
    staffId: string;
    track: string;
    note?: string;
  },
) {
  const settings = await loadDisciplineSettings();
  if (!canControl(me, settings)) throw new Error("You don't have the controls for automatic letters.");
  if (!isTrack(input.track)) throw new Error("Choose the rule.");
  const { data: who } = await supabaseAdmin.from("staff_users").select("id, user_id, full_name, store_name").eq("id", input.staffId).maybeSingle();
  const w = who as {
    id: string;
    user_id: string;
    full_name: string;
    store_name: string | null;
  } | null;
  if (!w) throw new Error("Staff member not found.");
  const stores = controlStores(me);
  if (stores && !(w.store_name && stores.includes(w.store_name.toUpperCase()))) throw new Error("This person is not in your store.");
  const { data: cur } = await supabaseAdmin.from("discipline_cases").select("*").eq("staff_id", w.id).eq("track", input.track).maybeSingle();
  const c = cur as DisciplineCase | null;
  const today = istNow().date;
  const note = (input.note ?? "").trim().slice(0, 300) || null;
  const base = {
    ...(c?.id ? { id: c.id } : {}),
    staff_id: w.id,
    user_id: w.user_id,
    staff_name: w.full_name,
    store: w.store_name ? w.store_name.toUpperCase() : null,
    track: input.track,
    stage: c?.stage ?? "watching",
    status: c?.status ?? ("active" as const),
    data: c?.data ?? {},
    note: c?.note ?? null,
    paused_by: c?.paused_by ?? null,
    last_action_at: c?.last_action_at ?? null,
  };
  let saved: DisciplineCase;
  if (input.action === "pause") {
    saved = await saveCase({
      ...base,
      status: "paused",
      paused_by: me.fullName,
      note: note ?? `Paused by ${me.fullName}`,
    });
  } else if (input.action === "resume") {
    if (base.stage === "terminated") throw new Error("A termination letter was sent: reset the case to start again.");
    // Nothing is counted for the paused days.
    const data = input.track === "performance" ? base.data : { ...base.data, countedUntil: addDays(today, -1) };
    saved = await saveCase({
      ...base,
      status: "active",
      paused_by: null,
      note: null,
      data,
    });
  } else {
    // Start again from today: nothing before counts, the plan (if any) ends.
    const data: CaseData = input.track === "performance" ? { since: addMonths(monthOf(today), 0) } : { countedUntil: addDays(today, -1) };
    saved = await saveCase({
      ...base,
      stage: "watching",
      status: "active",
      paused_by: null,
      note: null,
      data,
    });
  }
  await addEvent(saved.id, input.action, note, null, me.fullName);
  return saved;
}

/** Cases, history and people for the page (a Store Manager controller sees their store only). */
export async function disciplineOverview(me: StaffUser) {
  const settings = await loadDisciplineSettings();
  const stores = controlStores(me);
  let cases: DisciplineCase[] = [];
  let events: CaseEvent[] = [];
  let runs: {
    day: string;
    finished_at: string | null;
    result: string | null;
  }[] = [];
  let ready = true;
  try {
    cases = await loadCases();
    if (stores) cases = cases.filter((c) => c.store && stores.includes(c.store.toUpperCase()));
    const ids = cases.map((c) => c.id);
    if (ids.length) {
      const { data } = await supabaseAdmin.from("discipline_events").select("*").in("case_id", ids).order("at", { ascending: false }).limit(300);
      events = (data ?? []) as CaseEvent[];
    }
    const { data: r } = await supabaseAdmin.from("discipline_runs").select("day, finished_at, result").order("day", { ascending: false }).limit(7);
    runs = (r ?? []) as typeof runs;
  } catch {
    ready = false;
  }
  return { settings, cases, events, runs, ready };
}

/** Next step of a case, in words. */
export function nextStep(c: DisciplineCase): string {
  if (c.status === "paused") return "Paused — no automatic letters";
  const d = c.data;
  switch (c.stage) {
    case "pip":
      return `PIP review on ${formatDate(d.reviewOn ?? null)}: second warning if not improved`;
    case "second":
      return `Review on ${formatDate(d.reviewOn ?? null)}: final warning (for the Super Admin) if not improved`;
    case "final_waiting":
      return "Final warning waiting for the Super Admin to send it";
    case "final":
      return `Review on ${formatDate(d.reviewOn ?? null)}: termination letter (for the Super Admin) if not improved`;
    case "termination_waiting":
      return "Termination letter waiting for the Super Admin (fill in the last working day)";
    case "terminated":
      return "Termination letter sent";
    default:
      if (c.track === "late")
        return d.lastActionMonth
          ? `Counting late coming after ${formatDate(d.countedUntil ?? null)}; a repeat in ${monthName(d.lastActionMonth)} or the next month → warning`
          : "Counting late coming";
      if (c.track === "sop_sm") return `Counting deviations after ${formatDate(d.countedUntil ?? null)}`;
      if (c.track === "plans" || c.track === "walkins")
        return d.lastActionMonth
          ? `Counting after ${formatDate(d.countedUntil ?? null)}; a repeat in ${monthName(d.lastActionMonth)} or the next month → warning`
          : `Counting after ${formatDate(d.countedUntil ?? null)}`;
      return d.since ? `Watching sales from ${monthName(d.since)}` : "Watching sales";
  }
}
