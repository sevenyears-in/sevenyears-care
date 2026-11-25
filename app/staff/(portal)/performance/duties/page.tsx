import { supabaseAdmin } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { attendanceCode } from "@/lib/attendance";
import { formatDateTime, todayISO } from "@/lib/helpers";
import { monthReport } from "@/lib/performance";
import { isMonth, lateTime, minutesToTime, pct } from "@/lib/performance-rules";
import { loadAssignments, shiftOn, storeOn } from "@/lib/assignments";
import { dutyAccess, dutyDays, JUSTIFY_KINDS } from "@/lib/duties";
import { JustifyDay, RemoveJustification } from "@/components/DutyJustify";
import { canWriteLetters } from "@/lib/warning-letters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Duties" };

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const kindLabel = (k: string) => JUSTIFY_KINDS.find((x) => x.key === k)?.label ?? k;

export default async function DutiesPage({ searchParams }: { searchParams: Promise<{ u?: string; m?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  const sp = await searchParams;
  const thisMonth = todayISO().slice(0, 7);
  const month = isMonth(sp.m) && sp.m <= thisMonth ? sp.m : thisMonth;
  const userId = attendanceCode(sp.u || staff.userId);

  const report = await monthReport(month);
  let person = null as null | { name: string; store: string; periodTo: string | null; attendance: (typeof report.stores)[number]["people"][number]["attendance"] };
  for (const s of report.stores) {
    const p = s.people.find((x) => x.userId === userId);
    if (p && (!person || (p.period?.to ?? "9999") > (person.periodTo ?? "9999"))) {
      person = { name: p.name, store: s.store, attendance: p.attendance, periodTo: p.period?.to ?? null };
    }
  }
  const access = await dutyAccess(staff, userId, person?.store ?? null);
  if (!access.view) redirect("/staff/performance");
  const canJustify = access.justify && attendanceCode(staff.userId) !== userId;
  // Shift of each day (a shift can change during the month, from its "valid from" date).
  const assignments = await loadAssignments();
  const monthEnd = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
  const lastDay = todayISO() < monthEnd ? todayISO() : monthEnd;
  const shift = shiftOn(report.settings, assignments, userId, lastDay);
  // People not in the sales report (e.g. a store not tracked for targets): name and store from their account.
  const { data: acct } = await supabaseAdmin.from("staff_users").select("full_name, store_name").eq("user_id", userId).maybeSingle();
  const staffStore = acct?.store_name ? String(acct.store_name).toUpperCase() : null;
  const homeStore = person?.store ?? staffStore;
  const days = await dutyDays(userId, month, {
    shift: (day) => shiftOn(report.settings, assignments, userId, day),
    grace: report.settings.lateGraceMinutes,
    store: (day) => storeOn(assignments, userId, day) ?? homeStore,
  });
  const lateDays = days.filter((d) => d.late);
  const a = person?.attendance;
  const absent = days.filter((d) => d.status === "absent").length;

  const tone: Record<string, string> = {
    present: "bg-green-50 ring-green-200",
    justified: "bg-[#8883d7]/10 ring-[#8883d7]/30",
    absent: "bg-red-50 ring-red-200",
    no_data: "bg-black/[0.03] ring-black/5",
    today: "bg-amber-50 ring-amber-200",
    future: "bg-white ring-black/5 opacity-50",
  };
  const label: Record<string, string> = {
    present: "Present",
    justified: "Justified",
    absent: "Absent",
    no_data: "No punching data",
    today: "Today",
    future: "",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">Duties</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{person?.name ?? acct?.full_name ?? userId}</h1>
          <p className="mt-1 text-sm text-black/55">
            {userId} · {person?.store ?? staffStore ?? "—"} · {monthLabel(month)}
          </p>
        </div>
        <Link href={`/staff/performance${sp.u ? `?u=${encodeURIComponent(userId)}` : ""}`} className="rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-black/5">
          ← Back to performance
        </Link>
      </div>

      {a && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-2xl bg-white p-4 soft-card ring-1 ring-black/5">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-black/45">Duties</p>
            <p className="mt-1 text-2xl font-bold">
              {a.duties + a.noData}/{a.required}
            </p>
            <p className="text-xs text-black/55">
              {a.duties - a.justified} present · {a.justified} justified{a.noData ? ` · ${a.noData} no data` : ""}
            </p>
          </div>
          <div className="rounded-2xl bg-white p-4 soft-card ring-1 ring-black/5">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-black/45">Absent, not justified</p>
            <p className={`mt-1 text-2xl font-bold ${absent ? "text-[#d6224a]" : ""}`}>{absent}</p>
            <p className="text-xs text-black/55">{canJustify ? "Justify a day below if it was approved" : "HR or the Store Manager can justify"}</p>
          </div>
          <div className={`rounded-2xl bg-white p-4 soft-card ring-1 ${lateDays.length ? "ring-amber-200" : "ring-black/5"}`}>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-black/45">Late comings</p>
            <p className={`mt-1 text-2xl font-bold ${lateDays.length ? "text-amber-700" : ""}`}>{lateDays.length}</p>
            <p className="text-xs text-black/55">
              {shift.name} {minutesToTime(shift.start)}
              {shift.end !== null ? `–${minutesToTime(shift.end)}` : ""} · {report.settings.lateGraceMinutes} min grace
              {lateDays.length ? ` · ${lateTime(lateDays.reduce((s, d) => s + (d.late ?? 0), 0))} in all` : ""}
            </p>
            {(lateDays.length > 0 || absent > 0) && canWriteLetters(staff.role) && attendanceCode(staff.userId) !== userId && (
              <Link
                href={`/staff/letters?code=${encodeURIComponent(userId)}&kind=attendance&m=${month}`}
                className="mt-1 inline-block text-xs font-bold text-[#ff5e79] hover:underline"
              >
                ✉️ Warning letter
              </Link>
            )}
          </div>
          <div className="rounded-2xl bg-white p-4 soft-card ring-1 ring-black/5">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-black/45">Days left</p>
            <p className="mt-1 text-2xl font-bold">{a.remaining}</p>
            <p className="text-xs text-black/55">{Math.max(0, a.required - a.duties - a.noData)} more duties needed</p>
          </div>
          <div className="rounded-2xl bg-white p-4 soft-card ring-1 ring-black/5">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-black/45">Incentive paid</p>
            <p className={`mt-1 text-2xl font-bold ${a.absences ? "text-[#d6224a]" : "text-green-700"}`}>{pct(a.share)}</p>
            <p className="text-xs text-black/55">{a.absences ? `${a.absences} unauthorised absence(s)` : "No cut so far"}</p>
          </div>
        </div>
      )}

      <section className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((d) => (
            <div key={d.date} className={`rounded-2xl p-3 text-sm ring-1 ${tone[d.status]}`}>
              <div className="flex items-baseline justify-between">
                <span className="font-bold">{Number(d.date.slice(8))}</span>
                <span className="text-[11px] text-black/45">{WD[d.weekday]}</span>
              </div>
              <p className="mt-1 text-xs font-semibold">{label[d.status]}</p>
              {d.status === "present" && (
                <p className="text-[11px] text-black/55">
                  {d.first}
                  {d.last ? ` – ${d.last}` : ""}
                </p>
              )}
              {d.late ? <p className="mt-0.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Late by {lateTime(d.late)}</p> : null}
              {d.onePunch ? (
                <p className="mt-0.5 inline-block rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-bold text-black/60" title="Only one punch, long after the shift start: the in- or out-punch is missing. Not counted as late.">
                  One punch only
                </p>
              ) : null}
              {d.justification && (
                <div className="mt-1 text-[11px] text-black/60">
                  <p className="font-semibold text-[#5b55c9]">{kindLabel(d.justification.kind)}</p>
                  {d.justification.reason && <p>{d.justification.reason}</p>}
                  <p className="text-black/40">
                    by {d.justification.by} · {formatDateTime(d.justification.at)}
                  </p>
                  {canJustify && <RemoveJustification userId={userId} day={d.date} />}
                </div>
              )}
              {canJustify && (d.status === "absent" || d.status === "no_data") && (
                <div className="mt-2">
                  <JustifyDay userId={userId} day={d.date} />
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-black/50">
          Present = punched on the machine. Late = first punch after the start of the shift of that day plus the grace minutes. A day with only one punch long after the start (or only after the shift ended) shows “One punch only” and is not counted as late. Days when the store’s punching machine sent nothing are not counted as absent. A justified day counts as a duty. The 26-duty rule: each duty short is
          one unauthorised absence (1 → 75% of incentive paid, 2 → 50%, 3 or more → nothing).
        </p>
        {staff.role === "super_admin" && days.some((d) => d.status === "no_data") && (
          <p className="mt-2 text-xs">
            <Link href="/staff/admin/attendance" className="font-semibold text-[#5b55c9] underline">
              ↻ Pull the missing punches from eTimeTrackLite
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
