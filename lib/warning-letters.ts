// Warning letters (server only).
//
// Who writes: Super Admin, HR Head / HR Executive and Directors send straight to the staff member;
// a Store Manager writes for their own store's staff and the letter waits until HR or a Director
// approves it. The staff member gets an alert, a phone notification and an e-mail with the PDF
// letter, and acknowledges it in the app ("I have read this letter"), optionally with a reply.

import { supabaseAdmin } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";
import { EMPTY_ACCESS_CONFIG, resolveAccess } from "@/lib/access";
import { loadAccessConfig } from "@/lib/access-config";
import type { StaffUser } from "@/lib/auth";
import { formatDate } from "@/lib/helpers";
import { sendEmail, siteUrl } from "@/lib/notify";
import { pushToStaff } from "@/lib/push";
import { buildWarningLetterPdf } from "@/lib/warning-letter-pdf";
import { attendanceCode } from "@/lib/attendance";
import { clockIST } from "@/lib/store-open-close";
import { daysCount, daysPhrase, timesPhrase } from "@/lib/letter-text";

import { LETTER_SERIES, docName, letterTitle, type LetterKind } from "@/lib/letter-kinds";
export { LETTER_KINDS, MANUAL_KINDS, isLetterKind, docName, type LetterKind } from "@/lib/letter-kinds";

export type Letter = {
  id: string;
  number: string | null;
  staff_id: string;
  user_id: string;
  staff_name: string;
  store: string | null;
  designation: string | null;
  kind: LetterKind;
  subject: string;
  body: string;
  status: "pending" | "sent" | "rejected" | "withdrawn" | "revoked";
  created_by: string | null;
  created_by_name: string | null;
  created_by_role: string | null;
  created_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  reject_reason: string | null;
  issued_by_name: string | null;
  issued_by_role: string | null;
  sent_at: string | null;
  email_status: string | null;
  ack_at: string | null;
  ack_note: string | null;
  revoked_at?: string | null;
  revoked_by_name?: string | null;
  revoke_reason?: string | null;
  seen_at?: string | null;
  last_seen_at?: string | null;
  seen_count?: number | null;
  /** Issued by the automatic rules (lib/discipline.ts). */
  auto?: boolean | null;
  rule?: string | null;
  /** "super_admin": only the Super Admin can send it (final warning, termination). */
  needs?: string | null;
  case_id?: string | null;
};

const SENDS_DIRECTLY: Role[] = ["super_admin", "hr_head", "hr_executive", "director"];
/** People who can write a letter (a Store Manager's needs approval). */
export const canWriteLetters = (r: Role) => SENDS_DIRECTLY.includes(r) || r === "store_manager";
/** People who approve Store Managers' letters and see all letters (Directors: their stores). */
export const canApproveLetters = (r: Role) => SENDS_DIRECTLY.includes(r);
export const sendsDirectly = (r: Role) => SENDS_DIRECTLY.includes(r);

/** Stores this person writes / approves / sees letters for; null = all. */
export function letterStores(me: StaffUser): string[] | null {
  if (me.role === "store_manager") return me.storeName ? [me.storeName.toUpperCase()] : [];
  if (me.role === "director" && me.directorStores.length) return me.directorStores.map((s) => s.toUpperCase());
  return canApproveLetters(me.role) ? null : [];
}

const inStores = (stores: string[] | null, store: string | null) => stores === null || (!!store && stores.includes(store.toUpperCase()));

/** Can this person see this letter? */
export function canSeeLetter(me: StaffUser, l: Letter) {
  if (l.staff_id === me.id) return l.status === "sent" || l.status === "revoked";
  if (l.created_by === me.id) return true;
  return canApproveLetters(me.role) && inStores(letterStores(me), l.store);
}

/** Staff a person may write to: active, in their stores, not themselves, not management above them. */
export async function letterRecipients(me: StaffUser) {
  const stores = letterStores(me);
  const [{ data }, config] = await Promise.all([
    supabaseAdmin
      .from("staff_users")
      .select("id, user_id, full_name, role, store_name, custom_role_id, extra_sections")
      .eq("is_active", true)
      .order("full_name"),
    loadAccessConfig().catch(() => EMPTY_ACCESS_CONFIG),
  ]);
  const top: Role[] = ["super_admin", "director"];
  const office: Role[] = ["hr_head", "hr_executive", "admin", "operations_manager"];
  type Row = { id: string; user_id: string; full_name: string; role: Role; store_name: string | null; custom_role_id: string | null; extra_sections: string[] | null };
  return ((data ?? []) as Row[])
    .filter((s) => s.id !== me.id && !top.includes(s.role))
    .filter((s) => me.role !== "store_manager" || !office.includes(s.role))
    .filter((s) => inStores(stores, s.store_name))
    .map((s) => ({
      id: s.id,
      userId: s.user_id,
      name: s.full_name,
      store: s.store_name,
      designation: resolveAccess(config, { role: s.role, storeName: s.store_name, customRoleId: s.custom_role_id, extraSections: s.extra_sections }).roleLabel,
    }));
}

// ------------------------------------------------------------------
// Templates (filled in from the records; the writer can edit everything)
// ------------------------------------------------------------------

const prevMonth = () => {
  const d = new Date(Date.now() + 5.5 * 3_600_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const money = (n: number) => `Rs. ${Math.round(n).toLocaleString("en-IN")}`;

/** One deviation at a store on a day (from Care's opening / closing records). */
export type SopIncident = {
  day: string;
  store: string;
  kind: "open" | "close" | "cam_early" | "cam_late" | "proxy_open" | "proxy_close";
  who: string;
  time: string | null;
};

/**
 * Deviations from the opening / closing SOP between two days: openings and closings by someone not
 * allowed (and not approved by the Director), camera flags and proxy marks. For a store (the SM's
 * letter) or for the person who opened / closed (code).
 */
export async function sopIncidents(store: string | null, code: string | null, from: string, to?: string): Promise<SopIncident[]> {
  type R = {
    day: string; store: string;
    opened_at: string | null; opened_by: string | null; opened_by_name: string | null; open_sop: string | null; open_cam: string | null; open_cam_flag: string | null; open_entry_at: string | null;
    closed_at: string | null; closed_by: string | null; closed_by_name: string | null; close_sop: string | null; close_cam: string | null; close_cam_flag: string | null; close_exit_at: string | null;
  };
  let q = supabaseAdmin
    .from("store_open_close")
    .select("day, store, opened_at, opened_by, opened_by_name, open_sop, open_cam, open_cam_flag, open_entry_at, closed_at, closed_by, closed_by_name, close_sop, close_cam, close_cam_flag, close_exit_at")
    .gte("day", from)
    .order("day");
  if (to) q = q.lte("day", to);
  if (store) q = q.eq("store", store);
  const { data } = await q;
  const rows = (data ?? []) as R[];
  // Names as in Care today (days saved before a person had an account show "User ID 1005").
  const { data: accts } = await supabaseAdmin.from("staff_users").select("user_id, full_name");
  const names = new Map(((accts ?? []) as { user_id: string; full_name: string | null }[]).filter((a) => a.full_name).map((a) => [attendanceCode(a.user_id), String(a.full_name)]));
  const whoCode = (name: string | null, c: string | null) => {
    const saved = (name ?? "").replace(/\s*\([^)]*\)\s*$/, "");
    return (c ? names.get(attendanceCode(c)) : undefined) ?? (saved && !/^User ID /i.test(saved) ? saved : null) ?? (saved || "someone");
  };
  const out: SopIncident[] = [];
  for (const r of rows) {
    const opener = whoCode(r.opened_by_name, r.opened_by);
    const closer = whoCode(r.closed_by_name, r.closed_by);
    const mineOpen = !code || attendanceCode(r.opened_by) === code;
    const mineClose = !code || attendanceCode(r.closed_by) === code;
    if (r.open_sop === "violation" && mineOpen) out.push({ day: r.day, store: r.store, kind: "open", who: opener, time: r.opened_at ? clockIST(r.opened_at) : null });
    if (r.close_sop === "violation" && mineClose) out.push({ day: r.day, store: r.store, kind: "close", who: closer, time: r.closed_at ? clockIST(r.closed_at) : null });
    if (store) {
      if (r.open_cam_flag === "early") out.push({ day: r.day, store: r.store, kind: "cam_early", who: "", time: r.open_entry_at ? clockIST(r.open_entry_at) : null });
      if (r.close_cam_flag === "late") out.push({ day: r.day, store: r.store, kind: "cam_late", who: "", time: r.close_exit_at ? clockIST(r.close_exit_at) : null });
    }
    if (r.open_cam === "proxy" && mineOpen) out.push({ day: r.day, store: r.store, kind: "proxy_open", who: opener, time: r.opened_at ? clockIST(r.opened_at) : null });
    if (r.close_cam === "proxy" && mineClose) out.push({ day: r.day, store: r.store, kind: "proxy_close", who: closer, time: r.closed_at ? clockIST(r.closed_at) : null });
  }
  return out;
}

/** Deviations grouped by person and kind: one line each, the most frequent first. */
export function sopLines(items: SopIncident[], forStore: boolean): string[] {
  const groups = new Map<string, SopIncident[]>();
  for (const it of items) {
    const k = `${it.kind}|${it.who}|${forStore ? "" : it.store}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  return [...groups.values()]
    .sort((a, b) => b.length - a.length || a[0].day.localeCompare(b[0].day))
    .map((g) => {
      const it = g[0];
      const days = daysPhrase(g.map((x) => x.day));
      const n = g.length === 1 ? ` ${days}` : days.startsWith("every") ? ` on ${daysCount(g.length)}, ${days}` : ` on ${daysCount(g.length)} (${days.replace(/^on /, "")})`;
      const t = timesPhrase(g.map((x) => x.time ?? "").filter(Boolean));
      const at = t ? `, ${t}` : "";
      const where = forStore ? "the store" : it.store;
      switch (it.kind) {
        case "open":
          return forStore ? `- ${it.who} opened ${where}${n}${at}, without being allowed to open it.` : `- You opened ${where}${n}${at}.`;
        case "close":
          return forStore ? `- ${it.who} closed ${where}${n}${at}, without being allowed to close it.` : `- You closed ${where}${n}${at}.`;
        case "cam_early":
          return `- Entrance camera: someone entered the store before an allowed person had punched${n}${t ? ` (first entry ${t.replace(/^at /, "")})` : ""}.`;
        case "cam_late":
          return `- Entrance camera: someone left the store after the allowed person had punched out${n}${t ? ` (last exit ${t.replace(/^at /, "")})` : ""}.`;
        case "proxy_open":
          return `- Entrance camera: someone else punched for ${forStore ? it.who : "you"} at the opening${n}.`;
        case "proxy_close":
          return `- Entrance camera: someone else punched for ${forStore ? it.who : "you"} at the closing${n}.`;
      }
    });
}

export async function letterTemplate(
  kind: LetterKind,
  person: { id: string; userId: string; name: string; store: string | null },
  month?: string,
  opts?: { from?: string; to?: string; lateOnly?: boolean; ref?: string }
) {
  const first = person.name.split(" ")[0];
  const ref = opts?.ref ? `${opts.ref}\n\n` : "";
  const close =
    "\nYou are instructed to correct this immediately. Any repetition will lead to stricter disciplinary action as per company policy.";
  if (kind === "sop") {
    // The Store Manager answers for who opens and closes the store: the letter lists the
    // deviations at their store from Care's records (punches, SOP check, camera check), grouped.
    const from = opts?.from ?? new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const smStore = await smStoreOf(person.userId);
    const items = await sopIncidents(smStore, smStore ? null : attendanceCode(person.userId), from, opts?.to);
    const lines = sopLines(items, Boolean(smStore));
    const period = opts?.from ? `since ${formatDate(opts.from)}` : "in the last 60 days";
    if (smStore) {
      return {
        subject: `Warning for not following the store opening / closing SOP at ${smStore}`,
        body: `Dear ${first},\n\n${ref}As the Store Manager of ${smStore}, you are responsible for making sure that the store is opened and closed only by the Store Manager or the ASM / Floor Manager, or by a person the management has allowed in advance. The records in Seven Years Care (punching machine and entrance camera) show the following deviations ${period}:\n\n${lines.length ? lines.join("\n") : `- No deviations recorded ${period}.`}\n\nThis is a serious lapse in the control of the store. You must personally open and close the store (or ensure the ASM / Floor Manager does) and must not hand over the keys to anyone else without the management's approval.\n${close}`,
      };
    }
    return {
      subject: "Warning for not following the store opening / closing SOP",
      body: `Dear ${first},\n\nThis letter is a formal warning about the following deviations from the Standard Operating Procedure (SOP) for opening and closing the store, as recorded in Seven Years Care:\n\n${lines.length ? lines.join("\n") : `- No deviations recorded ${period}.`}\n\nAs per the SOP, only the Store Manager or the ASM / Floor Manager may open and close the store, unless the management has allowed someone else in advance. These deviations are serious.\n${close}`,
    };
  }
  if (kind === "performance") {
    const m = month ?? prevMonth();
    let line = "- Sales: [achieved] against the target of [target] ([%] achieved)";
    try {
      const { monthReport } = await import("@/lib/performance");
      const report = await monthReport(m);
      const p = report.stores.flatMap((s) => s.people).find((x) => x.userId === person.userId);
      if (p && p.target) line = `- Sales: ${money(p.net)} against your target of ${money(p.target)} (${Math.round((p.net / p.target) * 100)}% achieved)\n- Bills: ${p.bills}, average bill value: ${money(p.abv)}`;
      else if (p) line = `- Sales: ${money(p.net)} (${p.bills} bills, average bill value ${money(p.abv)})`;
    } catch {
      /* the report could not be read: the writer fills it in */
    }
    return {
      subject: `Warning for low sales performance in ${monthName(m)}`,
      body: `Dear ${first},\n\nThis letter is a formal warning about your sales performance in ${monthName(m)}:\n\n${line}\n\nThis is well below what is expected from you. You are expected to improve your performance and reach your targets from this month on. The management will support you with guidance and training where needed.\n${close}`,
    };
  }
  if (kind === "attendance" || kind === "reminder") {
    // Late arrivals and absences from the punching machine (the same rules as Duties).
    const m = month ?? new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7);
    const lines: string[] = [];
    let lateTotal = 0;
    let absentCount = 0;
    try {
      const [{ dutyDays }, { loadAssignments, shiftOn, storeOn }, { loadPerformanceSettings }, { lateTime, minutesToTime }] = await Promise.all([
        import("@/lib/duties"),
        import("@/lib/assignments"),
        import("@/lib/performance-settings"),
        import("@/lib/performance-rules"),
      ]);
      const [settings, assignments] = await Promise.all([loadPerformanceSettings(), loadAssignments()]);
      const days = await dutyDays(person.userId, m, {
        shift: (day) => shiftOn(settings, assignments, person.userId, day),
        grace: settings.lateGraceMinutes,
        store: (day) => storeOn(assignments, person.userId, day) ?? (person.store ? person.store.toUpperCase() : null),
      });
      const inRange = (d: string) => (!opts?.from || d >= opts.from) && (!opts?.to || d <= opts.to);
      const late = days.filter((d) => d.late && d.status === "present" && !d.justification && inRange(d.date));
      const absent = opts?.lateOnly || kind === "reminder" ? [] : days.filter((d) => d.status === "absent" && inRange(d.date));
      lateTotal = late.reduce((t, d) => t + (d.late ?? 0), 0);
      absentCount = absent.length;
      if (late.length) {
        const starts = [...new Set(late.map((d) => minutesToTime(shiftOn(settings, assignments, person.userId, d.date).start)))];
        const list = daysPhrase(late.map((d) => d.date)).replace(/^on /, "");
        const times = timesPhrase(late.map((d) => d.first ?? "").filter(Boolean));
        lines.push(
          `- You came late on ${daysCount(late.length)} (${list})${times ? `, ${times}` : ""}: ${lateTime(lateTotal)} late in all. Your shift starts at ${starts.join(" / ")}, with ${settings.lateGraceMinutes} minutes' grace.`
        );
      }
      if (absent.length) lines.push(`- You were absent without permission on ${daysCount(absent.length)} (${daysPhrase(absent.map((d) => d.date)).replace(/^on /, "")}): no punch and no justification.`);
    } catch {
      /* attendance not available: the writer fills it in */
    }
    if (kind === "reminder") {
      return {
        subject: `Reminder about punctuality in ${monthName(m)}`,
        body: `Dear ${first},\n\nThis is a reminder about your punctuality. The punching machine shows the following in ${monthName(m)}:\n\n${lines.length ? lines.join("\n") : "- [dates and times of late coming]"}\n\nWe value your work at Seven Years, and being on time is part of it: it lets the team open the floor on time and serve our customers well. Please make sure you punch in before your shift starts from now on. If there is a reason we should know about, please speak to your Store Manager or HR.\n\nPlease note that if late coming continues, a warning letter will be issued as per company policy.`,
      };
    }
    return {
      subject: `Warning for late coming${absentCount ? " and absence" : ""} in ${monthName(m)}`,
      body: `Dear ${first},\n\n${ref}This letter is a formal warning about your attendance and punctuality in ${monthName(m)}, as recorded by the punching machine:\n\n${lines.length ? lines.join("\n") : "- [dates: late arrival / early leaving / absence without permission]"}\n\nRegular and punctual attendance is a basic requirement of your job. You are expected to be on the floor before your shift starts.\n${close}`,
    };
  }
  if (kind === "conduct") {
    // Explanations asked from this person in the last 60 days (complaints, delays) and their replies.
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const { data } = await supabaseAdmin
      .from("ticket_explanations")
      .select("ticket_number, reason, requested_at, explanation, explained_at")
      .eq("staff_id", person.id)
      .gte("requested_at", since)
      .order("requested_at");
    const rows = (data ?? []) as { ticket_number: string; reason: string; requested_at: string; explanation: string | null; explained_at: string | null }[];
    const lines = rows
      .filter((r) => !/^(Withdrawn by )/.test(r.explanation ?? ""))
      .map((r) => `- ${formatDate(r.requested_at)} (${r.ticket_number}): ${r.reason}${r.explanation ? ` - your explanation: "${r.explanation.replace(/^Recorded by [^:]*:\s*/, "").slice(0, 300)}"` : " - no explanation given"}`);
    return {
      subject: "Warning for misconduct",
      body: `Dear ${first},\n\nThis letter is a formal warning about the following:\n\n${lines.length ? lines.join("\n") : "- [date, place and what happened]"}\n\nSuch behaviour is not acceptable and is against the company's code of conduct.\n${close}`,
    };
  }
  return { subject: "Warning letter", body: `Dear ${first},\n\n[details]\n${close}` };
}

// ------------------------------------------------------------------
// Sending, approving, acknowledging
// ------------------------------------------------------------------

async function nextNumber(kind: LetterKind): Promise<string> {
  const year = new Date(Date.now() + 5.5 * 3_600_000).getUTCFullYear();
  const series = LETTER_SERIES[kind] ?? "WL";
  const { count } = await supabaseAdmin.from("warning_letters").select("id", { count: "exact", head: true }).like("number", `SY/${series}/${year}/%`);
  return `SY/${series}/${year}/${String((count ?? 0) + 1).padStart(3, "0")}`;
}

export function letterPdfData(l: Letter) {
  return {
    title: letterTitle(l.kind),
    number: l.number,
    sentAt: l.sent_at,
    createdAt: l.created_at,
    staffName: l.staff_name,
    userId: l.user_id,
    designation: l.designation,
    store: l.store,
    subject: l.subject,
    body: l.body,
    issuedByName: l.issued_by_name ?? l.created_by_name,
    issuedByRole: l.issued_by_role ?? l.created_by_role,
    ackAt: l.ack_at,
    ackNote: l.ack_note,
    revokedAt: l.status === "revoked" ? l.revoked_at ?? null : null,
    revokedBy: l.revoked_by_name ?? null,
    revokeReason: l.revoke_reason ?? null,
  };
}

export const letterFileName = (l: Letter) => `${(l.number ?? "warning-letter").replace(/\//g, "-")}.pdf`;

/** Gives the letter its number and delivers it: alert, phone notification, e-mail with the PDF. */
export async function sendLetter(id: string, issuer: { name: string; role: string }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: cur } = await supabaseAdmin.from("warning_letters").select("kind").eq("id", id).maybeSingle();
    const number = await nextNumber(((cur as { kind: LetterKind } | null)?.kind ?? "other") as LetterKind);
    const { data, error } = await supabaseAdmin
      .from("warning_letters")
      .update({ number, status: "sent", sent_at: new Date().toISOString(), issued_by_name: issuer.name, issued_by_role: issuer.role })
      .eq("id", id)
      .in("status", ["pending"])
      .select("*")
      .maybeSingle();
    if (error && /duplicate|23505/.test(`${error.code} ${error.message}`)) continue;
    if (error) throw error;
    if (!data) throw new Error("This letter can no longer be sent.");
    await deliver(data as Letter);
    return data as Letter;
  }
  throw new Error("Could not number the letter. Please try again.");
}

async function deliver(l: Letter) {
  const link = `${siteUrl()}/staff/letters/${l.id}`;
  const title = `${docName(l.kind)} ${l.number}`;
  await supabaseAdmin.from("staff_notifications").insert({
    staff_id: l.staff_id,
    ticket_type: null,
    ticket_id: l.id,
    ticket_number: l.number,
    title,
    body: `${l.subject}. Please read it and tap "I have read this letter".`,
  });
  await pushToStaff([l.staff_id], { title, body: `${l.subject}. Tap to read and acknowledge.`, url: link }).catch(() => undefined);
  const { data: who } = await supabaseAdmin.from("staff_users").select("email").eq("id", l.staff_id).maybeSingle();
  const email = (who as { email: string | null } | null)?.email;
  let status = "no e-mail address";
  if (email) {
    try {
      const pdf = await letterPdf(l);
      const r = await sendEmail(
        email,
        `${title}: ${l.subject} — Seven Years`,
        `Dear ${l.staff_name},\n\nPlease find attached ${docName(l.kind).toLowerCase()} ${l.number} (${l.subject}).\n\nRead it and acknowledge it in the Seven Years Care app:\n${link}\n\n— Seven Years`,
        { audience: "staff", ticketNumber: l.number ?? undefined },
        undefined,
        [{ filename: letterFileName(l), contentType: "application/pdf", content: pdf }]
      );
      status = r.ok ? "sent" : `failed: ${r.error ?? ""}`.slice(0, 200);
    } catch (e) {
      status = `failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    }
  }
  await supabaseAdmin.from("warning_letters").update({ email_status: status }).eq("id", l.id);
}

/** Tells the people who approve that a Store Manager's letter is waiting. */
export async function notifyApprovers(l: Letter) {
  const { data } = await supabaseAdmin.from("staff_users").select("id, role, director_stores").eq("is_active", true).in("role", SENDS_DIRECTLY);
  const ids = ((data ?? []) as { id: string; role: Role; director_stores: string[] | null }[])
    .filter((s) => (l.needs === "super_admin" ? s.role === "super_admin" : true))
    .filter((s) => s.role !== "director" || !s.director_stores?.length || (!!l.store && s.director_stores.map((x) => x.toUpperCase()).includes(l.store.toUpperCase())))
    .map((s) => s.id);
  if (!ids.length) return;
  const title = l.needs === "super_admin" ? `Letter to confirm: ${docName(l.kind)} to ${l.staff_name}` : `Warning letter to approve: ${l.staff_name}`;
  const body = l.auto ? `Prepared automatically (${l.store ?? ""}): ${l.subject}. Check it and send it.` : `${l.created_by_name} (${l.store ?? ""}) wrote: ${l.subject}`;
  await supabaseAdmin.from("staff_notifications").insert(
    ids.map((staff_id) => ({ staff_id, ticket_type: null, ticket_id: l.id, ticket_number: null, title, body }))
  );
  await pushToStaff(ids, { title, body: l.subject, url: `${siteUrl()}/staff/letters/${l.id}` }).catch(() => undefined);
}

/** Tells the writer (and the issuer) what happened to a letter. */
export async function notifyWriter(l: Letter, title: string, body: string) {
  const ids = [...new Set([l.created_by].filter(Boolean) as string[])];
  if (!ids.length) return;
  await supabaseAdmin.from("staff_notifications").insert(ids.map((staff_id) => ({ staff_id, ticket_type: null, ticket_id: l.id, ticket_number: l.number, title, body })));
  await pushToStaff(ids, { title, body, url: `${siteUrl()}/staff/letters/${l.id}` }).catch(() => undefined);
}

/** Letters waiting for this person: to acknowledge (their own) or to approve. */
export async function lettersWaiting(me: StaffUser): Promise<number> {
  const { count: mine } = await supabaseAdmin
    .from("warning_letters")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", me.id)
    .eq("status", "sent")
    .is("ack_at", null);
  let approve = 0;
  if (canApproveLetters(me.role)) {
    const stores = letterStores(me);
    let q = supabaseAdmin.from("warning_letters").select("id", { count: "exact", head: true }).eq("status", "pending");
    if (stores) q = q.in("store", stores);
    if (me.role !== "super_admin") q = q.is("needs", null);
    approve = (await q).count ?? 0;
  }
  return (mine ?? 0) + approve;
}

/** Has this person ever received a letter (to show "Letters" in the menu)? */
export async function hasLetters(me: StaffUser): Promise<boolean> {
  const { count } = await supabaseAdmin.from("warning_letters").select("id", { count: "exact", head: true }).eq("staff_id", me.id).eq("status", "sent");
  return (count ?? 0) > 0;
}

/** Menu entry: null = don't show; otherwise letters waiting for this person (to acknowledge or approve). */
export async function letterMenu(me: StaffUser): Promise<number | null> {
  try {
    const waiting = await lettersWaiting(me);
    if (canWriteLetters(me.role) || waiting > 0) return waiting;
    return (await hasLetters(me)) ? 0 : null;
  } catch {
    return canWriteLetters(me.role) ? 0 : null;
  }
}

// ------------------------------------------------------------------
// Reading and changing letters (used by the API routes and pages)
// ------------------------------------------------------------------

export async function getLetter(id: string): Promise<Letter | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabaseAdmin.from("warning_letters").select("*").eq("id", id).maybeSingle();
  return (data as Letter | null) ?? null;
}

/** Letters for the page: my own, waiting for my approval, and the ones I can see as issuer / approver. */
export async function lettersFor(me: StaffUser) {
  const { data: mineRaw } = await supabaseAdmin
    .from("warning_letters")
    .select("*")
    .eq("staff_id", me.id)
    .in("status", ["sent", "revoked"])
    .order("sent_at", { ascending: false });
  const mine = (mineRaw ?? []) as Letter[];
  let others: Letter[] = [];
  if (canApproveLetters(me.role)) {
    const stores = letterStores(me);
    let q = supabaseAdmin.from("warning_letters").select("*").neq("staff_id", me.id).order("created_at", { ascending: false }).limit(300);
    if (stores) q = q.in("store", stores);
    others = ((await q).data ?? []) as Letter[];
  } else if (canWriteLetters(me.role)) {
    const { data } = await supabaseAdmin.from("warning_letters").select("*").eq("created_by", me.id).order("created_at", { ascending: false }).limit(300);
    others = (data ?? []) as Letter[];
  }
  return {
    mine,
    toApprove: canApproveLetters(me.role) ? others.filter((l) => l.status === "pending" && (!l.needs || canDecide(me, l))) : [],
    issued: others.filter((l) => !canApproveLetters(me.role) || l.status !== "pending"),
  };
}

export async function createLetter(
  me: StaffUser,
  input: { staffId: string; kind: LetterKind; subject: string; body: string }
): Promise<Letter> {
  if (!canWriteLetters(me.role)) throw new Error("You can't issue warning letters.");
  const person = (await letterRecipients(me)).find((p) => p.id === input.staffId);
  if (!person) throw new Error("Choose a staff member you can issue a letter to.");
  const subject = input.subject.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 8000);
  if (subject.length < 4) throw new Error("Write the subject of the letter.");
  if (body.length < 20) throw new Error("Write the letter.");
  if (/\[(dates?|details|date, place|achieved)/i.test(body)) throw new Error("Replace the [ ... ] parts of the letter with the real details first.");
  // Name and title printed under "For Seven Years Kids Care LLP," (Settings on the Warning letters page).
  const sig = await signatureFor(me);
  const { data, error } = await supabaseAdmin
    .from("warning_letters")
    .insert({
      staff_id: person.id,
      user_id: person.userId,
      staff_name: person.name,
      store: person.store,
      designation: person.designation,
      kind: input.kind,
      subject,
      body,
      status: "pending",
      created_by: me.id,
      created_by_name: sig.name,
      created_by_role: sig.title,
    })
    .select("*")
    .single();
  if (error) throw error;
  const letter = data as Letter;
  if (sendsDirectly(me.role)) return sendLetter(letter.id, { name: sig.name, role: sig.title });
  await notifyApprovers(letter);
  return letter;
}

/**
 * A letter issued by the automatic rules, in the name (and with the signature) of the signer
 * chosen in the settings. Sent at once, or (needs = "super_admin") kept waiting for the Super Admin.
 */
export async function createAutoLetter(input: {
  staffId: string;
  kind: LetterKind;
  subject: string;
  body: string;
  rule: string;
  caseId: string | null;
  signerId: string;
  needs?: "super_admin" | null;
}): Promise<Letter> {
  const { data: who } = await supabaseAdmin.from("staff_users").select("id, user_id, full_name, role, store_name, custom_role_id, extra_sections").eq("id", input.staffId).maybeSingle();
  if (!who) throw new Error("Staff member not found.");
  const w = who as { id: string; user_id: string; full_name: string; role: Role; store_name: string | null; custom_role_id: string | null; extra_sections: string[] | null };
  const config = await loadAccessConfig().catch(() => EMPTY_ACCESS_CONFIG);
  const designation = resolveAccess(config, { role: w.role, storeName: w.store_name, customRoleId: w.custom_role_id, extraSections: w.extra_sections }).roleLabel;
  const sigs = await loadSignatures().catch(() => ({}) as Record<string, Sig>);
  const { data: signer } = await supabaseAdmin.from("staff_users").select("id, full_name, role").eq("id", input.signerId).maybeSingle();
  const sg = signer as { id: string; full_name: string; role: Role } | null;
  const sig = sigs[input.signerId] ?? { name: sg?.full_name ?? "Seven Years", title: "Management" };
  const { data, error } = await supabaseAdmin
    .from("warning_letters")
    .insert({
      staff_id: w.id,
      user_id: w.user_id,
      staff_name: w.full_name,
      store: w.store_name,
      designation,
      kind: input.kind,
      subject: input.subject.slice(0, 200),
      body: input.body.slice(0, 8000),
      status: "pending",
      created_by: sg?.id ?? null,
      created_by_name: sig.name,
      created_by_role: sig.title,
      auto: true,
      rule: input.rule,
      needs: input.needs ?? null,
      case_id: input.caseId,
    })
    .select("*")
    .single();
  if (error) throw error;
  const letter = data as Letter;
  if (input.needs) {
    await notifyApprovers(letter);
    return letter;
  }
  return sendLetter(letter.id, { name: sig.name, role: sig.title });
}

/** Approve (and send) a Store Manager's letter, possibly after correcting it. */
/** Can this person approve / reject this waiting letter? (Final warnings and terminations: Super Admin only.) */
export function canDecide(me: StaffUser, l: Letter) {
  if (l.needs === "super_admin") return me.role === "super_admin";
  return canApproveLetters(me.role) && inStores(letterStores(me), l.store);
}

export async function approveLetter(me: StaffUser, l: Letter, edits?: { subject?: string; body?: string }) {
  if (!canDecide(me, l)) throw new Error(l.needs === "super_admin" ? "Only the Super Admin can send this letter." : "You can't approve this letter.");
  if (l.status !== "pending") throw new Error("This letter is no longer waiting for approval.");
  const patch: Record<string, string> = { decided_by_name: me.fullName, decided_at: new Date().toISOString() };
  if (edits?.subject?.trim()) patch.subject = edits.subject.trim().slice(0, 200);
  if (edits?.body?.trim()) patch.body = edits.body.trim().slice(0, 8000);
  if (/\[[a-z ]*(last working day|date|details)[a-z ]*\]/i.test(patch.body ?? l.body)) throw new Error("Fill in the [ ... ] parts of the letter first (Edit, then approve).");
  await supabaseAdmin.from("warning_letters").update(patch).eq("id", l.id).eq("status", "pending");
  // Issued in the name of the Store Manager who wrote it, approved by HR / Director.
  const sent = await sendLetter(l.id, { name: l.created_by_name ?? me.fullName, role: l.created_by_role ?? me.access.roleLabel });
  if (l.created_by && l.created_by !== me.id && !l.auto) {
    await notifyWriter(sent, `Warning letter ${sent.number} sent`, `${me.fullName} approved your letter to ${l.staff_name}. It has been sent.`);
  }
  if (l.case_id) await (await import("@/lib/discipline")).onLetterDecided(sent, "sent", me.fullName).catch((e) => console.error("Discipline case:", e));
  return sent;
}

export async function rejectLetter(me: StaffUser, l: Letter, reason: string) {
  if (!canDecide(me, l)) throw new Error("You can't decide on this letter.");
  if (l.status !== "pending") throw new Error("This letter is no longer waiting for approval.");
  const why = reason.trim();
  if (why.length < 3) throw new Error("Say why the letter is not approved.");
  await supabaseAdmin
    .from("warning_letters")
    .update({ status: "rejected", reject_reason: why.slice(0, 1000), decided_by_name: me.fullName, decided_at: new Date().toISOString() })
    .eq("id", l.id)
    .eq("status", "pending");
  if (l.created_by && l.created_by !== me.id && !l.auto) {
    await notifyWriter(l, `Warning letter not approved: ${l.staff_name}`, `${me.fullName}: ${why}`);
  }
  if (l.case_id) await (await import("@/lib/discipline")).onLetterDecided(l, "rejected", me.fullName).catch((e) => console.error("Discipline case:", e));
}

/** The writer takes back a letter that is still waiting for approval. */
export async function withdrawLetter(me: StaffUser, l: Letter) {
  if (l.created_by !== me.id && me.role !== "super_admin") throw new Error("Only the person who wrote it can withdraw this letter.");
  if (l.status !== "pending") throw new Error("Only a letter waiting for approval can be withdrawn.");
  await supabaseAdmin.from("warning_letters").update({ status: "withdrawn", decided_by_name: me.fullName, decided_at: new Date().toISOString() }).eq("id", l.id).eq("status", "pending");
}

/** The staff member confirms they have read the letter (optionally with their reply). */
export async function acknowledgeLetter(me: StaffUser, l: Letter, note: string) {
  if (l.staff_id !== me.id || l.status !== "sent") throw new Error("This letter is not addressed to you.");
  if (l.ack_at) throw new Error("You have already acknowledged this letter.");
  const reply = note.trim().slice(0, 2000) || null;
  const { data } = await supabaseAdmin
    .from("warning_letters")
    .update({ ack_at: new Date().toISOString(), ack_note: reply })
    .eq("id", l.id)
    .is("ack_at", null)
    .select("*")
    .maybeSingle();
  if (data) {
    await notifyWriter(
      data as Letter,
      `Warning letter ${l.number} acknowledged`,
      `${l.staff_name} has read the letter${reply ? ` and replied: ${reply.slice(0, 200)}` : "."}`
    );
  }
}

/** Store of a Store Manager (incentive group "sm"); null when the person is not an SM. */
export async function smStoreOf(userId: string): Promise<string | null> {
  const { loadStaffForPerformance } = await import("@/lib/performance");
  const code = attendanceCode(userId);
  const p = (await loadStaffForPerformance()).find((x) => x.userId === code);
  return p && p.group === "sm" && p.store ? p.store : null;
}

/** Employee code of the Store Manager of a store (for SOP warnings). */
export async function smOfStore(store: string): Promise<string | null> {
  const { loadStaffForPerformance } = await import("@/lib/performance");
  const p = (await loadStaffForPerformance()).find((x) => x.group === "sm" && x.store === store.toUpperCase());
  return p?.userId ?? null;
}

// ------------------------------------------------------------------
// Signature printed on letters (each issuer sets their own name and title)
// ------------------------------------------------------------------

const SIG_KEY = "letter_signatures";
/** image: path of the handwritten signature in the private "letter-signatures" bucket. */
type Sig = { name: string; title: string; image?: string | null };
const SIG_BUCKET = "letter-signatures";

async function loadSignatures(): Promise<Record<string, Sig>> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", SIG_KEY).maybeSingle();
  const v = (data?.value ?? {}) as { list?: Record<string, Sig> };
  return v.list && typeof v.list === "object" ? v.list : {};
}

/** The issuer's signature: what they set, else their account name and role. */
export async function signatureFor(me: StaffUser): Promise<Sig & { custom: boolean; imageUrl: string | null }> {
  const own = (await loadSignatures().catch(() => ({}) as Record<string, Sig>))[me.id];
  let imageUrl: string | null = null;
  if (own?.image) {
    const { data } = await supabaseAdmin.storage.from(SIG_BUCKET).createSignedUrl(own.image, 60 * 10);
    imageUrl = data?.signedUrl ?? null;
  }
  const base = own?.name ? { name: own.name, title: own.title || me.access.roleLabel, custom: true } : { name: me.fullName, title: me.access.roleLabel, custom: false };
  return { ...base, image: own?.image ?? null, imageUrl };
}

export async function setSignature(me: StaffUser, name: string, title: string) {
  const list = await loadSignatures();
  const n = name.trim().slice(0, 80);
  const t = title.trim().slice(0, 80);
  const image = list[me.id]?.image ?? null;
  if (!n && !image) delete list[me.id];
  else list[me.id] = { name: n || me.fullName, title: t || me.access.roleLabel, image };
  await supabaseAdmin.from("app_settings").upsert({ key: SIG_KEY, value: { list }, updated_at: new Date().toISOString() });
}

/** Saves (or with null, removes) the issuer's handwritten signature image (PNG / JPEG, up to 1 MB). */
export async function setSignatureImage(me: StaffUser, file: { bytes: Uint8Array; type: string } | null) {
  const list = await loadSignatures();
  const cur = list[me.id] ?? { name: me.fullName, title: me.access.roleLabel, image: null };
  if (cur.image) await supabaseAdmin.storage.from(SIG_BUCKET).remove([cur.image]).catch(() => undefined);
  if (file) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error("Use a PNG or JPG picture of the signature.");
    if (file.bytes.length > 1024 * 1024) throw new Error("The picture is too large (1 MB at most).");
    const path = `${me.id}/${Date.now()}.${file.type === "image/png" ? "png" : "jpg"}`;
    const { error } = await supabaseAdmin.storage.from(SIG_BUCKET).upload(path, file.bytes, { contentType: file.type, upsert: true });
    if (error) throw error;
    cur.image = path;
  } else cur.image = null;
  list[me.id] = cur;
  await supabaseAdmin.from("app_settings").upsert({ key: SIG_KEY, value: { list }, updated_at: new Date().toISOString() });
}

/** The handwritten signature of the person a letter is issued by (its writer), if they uploaded one. */
async function signatureImageOf(staffId: string | null): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!staffId) return null;
  const path = (await loadSignatures().catch(() => ({}) as Record<string, Sig>))[staffId]?.image;
  if (!path) return null;
  const { data } = await supabaseAdmin.storage.from(SIG_BUCKET).download(path);
  if (!data) return null;
  return { bytes: new Uint8Array(await data.arrayBuffer()), type: path.endsWith(".png") ? "image/png" : "image/jpeg" };
}

/** The letter as a PDF (with the issuer's handwritten signature when there is one). */
export async function letterPdf(l: Letter): Promise<Uint8Array> {
  const signature = await signatureImageOf(l.created_by).catch(() => null);
  return buildWarningLetterPdf({ ...letterPdfData(l), signature });
}

/**
 * Revokes a letter that was sent (Super Admin, HR, Directors for their stores). It stays on record,
 * marked revoked; the staff member is told in the app, by phone notification and by e-mail.
 */
export async function revokeLetter(me: StaffUser, l: Letter, reason: string) {
  if (!canApproveLetters(me.role) || !inStores(letterStores(me), l.store)) throw new Error("You can't revoke this letter.");
  if (l.status !== "sent") throw new Error("Only a letter that was sent can be revoked.");
  const why = reason.trim();
  if (why.length < 3) throw new Error("Say why the warning is revoked.");
  const { data } = await supabaseAdmin
    .from("warning_letters")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by_name: (await signatureFor(me)).name, revoke_reason: why.slice(0, 1000) })
    .eq("id", l.id)
    .eq("status", "sent")
    .select("*")
    .maybeSingle();
  if (!data) throw new Error("This letter can no longer be revoked.");
  const title = `${docName(l.kind)} ${l.number} revoked`;
  const body = `The ${docName(l.kind).toLowerCase()} "${l.subject}" dated ${formatDate(l.sent_at)} has been withdrawn by the management and is no longer in force.`;
  await supabaseAdmin.from("staff_notifications").insert({ staff_id: l.staff_id, ticket_type: null, ticket_id: l.id, ticket_number: l.number, title, body });
  await pushToStaff([l.staff_id], { title, body, url: `${siteUrl()}/staff/letters/${l.id}` }).catch(() => undefined);
  const { data: who } = await supabaseAdmin.from("staff_users").select("email").eq("id", l.staff_id).maybeSingle();
  const email = (who as { email: string | null } | null)?.email;
  if (email) {
    await sendEmail(
      email,
      `${title} — Seven Years`,
      `Dear ${l.staff_name},\n\n${body}\n\nYou can see it in the Seven Years Care app:\n${siteUrl()}/staff/letters/${l.id}\n\n— Seven Years`,
      { audience: "staff", ticketNumber: l.number ?? undefined }
    ).catch(() => undefined);
  }
  if (l.created_by && l.created_by !== me.id && !l.auto) await notifyWriter(data as Letter, title, `${me.fullName} revoked the letter to ${l.staff_name}: ${why.slice(0, 200)}`);
  if (l.case_id) await (await import("@/lib/discipline")).onLetterDecided(data as Letter, "revoked", me.fullName).catch((e) => console.error("Discipline case:", e));
  return data as Letter;
}

/** Short-lived link to the issuer's signature picture (for the letter shown in the app). */
export async function signatureImageUrlOf(staffId: string | null): Promise<string | null> {
  if (!staffId) return null;
  const path = (await loadSignatures().catch(() => ({}) as Record<string, Sig>))[staffId]?.image;
  if (!path) return null;
  const { data } = await supabaseAdmin.storage.from(SIG_BUCKET).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

/** The staff member opened their letter (in the app, or its PDF): first and last time, and how often. */
export async function markLetterSeen(l: Letter) {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("warning_letters")
    .update({ seen_at: l.seen_at ?? now, last_seen_at: now, seen_count: (l.seen_count ?? 0) + 1 })
    .eq("id", l.id);
}
