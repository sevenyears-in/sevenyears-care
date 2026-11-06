import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { markAlertsRead } from "@/lib/alerts";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/helpers";
import { canSeeFeedback, feedbackScope } from "@/lib/feedback-access";
import { answerLabel, FORM_TITLES, feedbackQuestions, type FeedbackFormKind } from "@/lib/feedback-forms";
import { FeedbackFollowUp } from "@/components/FeedbackFollowUp";
import { hasSection } from "@/lib/access";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  kind: FeedbackFormKind;
  ref_id: string;
  ref_number: string;
  mobile: string | null;
  store_name: string | null;
  staff_name: string | null;
  confidential: boolean;
  answers: Record<string, string | number> | null;
  overall: number | null;
  resolved: string | null;
  comment: string | null;
  needs_followup: boolean;
  followup_done_at: string | null;
  followup_by: string | null;
  followup_note: string | null;
  created_at: string;
};

const TABS: { value: "all" | FeedbackFormKind | "followup"; label: string }[] = [
  { value: "followup", label: "Needs follow-up" },
  { value: "all", label: "All" },
  { value: "sales", label: "Sales" },
  { value: "service", label: "Service" },
  { value: "complaint", label: "Complaint handling" },
];

function avgNum(list: (number | null)[]) {
  const n = list.filter((v): v is number => typeof v === "number");
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
}

/** Colour for a 1–5 rating: green good, amber fair, red poor. */
function ratingStyle(v: number | null) {
  if (v === null) return "bg-black/5 text-black/35";
  if (v >= 4) return "bg-green-100 text-green-800";
  if (v >= 3) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-700";
}

const KIND_COLOUR: Record<string, string> = {
  sales: "#0fa8bf",
  service: "#8883d7",
  complaint: "#f39237",
  followup: "#ff5e79",
  all: "#161616",
};

export default async function FeedbackReportPage({ searchParams }: { searchParams: Promise<{ tab?: string; days?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (!hasSection(staff, "feedback")) redirect("/staff");

  after(() => markAlertsRead(staff.id, { titleLike: "%feedback%" }));
  const { tab: tabParam, days: daysParam } = await searchParams;
  const tab = TABS.some((t) => t.value === tabParam) ? (tabParam as (typeof TABS)[number]["value"]) : "followup";
  const days = [7, 30, 90, 365].includes(Number(daysParam)) ? Number(daysParam) : 30;
  const scope = feedbackScope(staff);

  let query = supabaseAdmin
    .from("customer_feedback")
    .select(
      "id, kind, ref_id, ref_number, mobile, store_name, staff_name, confidential, answers, overall, resolved, comment, needs_followup, followup_done_at, followup_by, followup_note, created_at"
    )
    .gte("created_at", new Date(Date.now() - days * 86400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1000);
  if (!scope.allStores) query = query.ilike("store_name", staff.storeName ?? "__none__");
  if (!scope.confidential) query = query.eq("confidential", false);
  if (scope.onlyConfidential) query = query.eq("confidential", true);

  const { data, error } = await query;
  const rows = (data ?? []) as Row[];
  const rated = rows.filter((r) => r.answers && Object.keys(r.answers).length > 0);

  // Store-wise summary
  const stores = new Map<string, Row[]>();
  for (const r of rated) {
    const key = r.store_name || "Not specified";
    stores.set(key, [...(stores.get(key) ?? []), r]);
  }
  const summary = [...stores.entries()]
    .map(([store, list]) => ({
      store,
      sales: list.filter((r) => r.kind === "sales"),
      service: list.filter((r) => r.kind === "service"),
      complaint: list.filter((r) => r.kind === "complaint"),
      followups: rows.filter((r) => (r.store_name || "Not specified") === store && r.needs_followup && !r.followup_done_at).length,
    }))
    .sort((a, b) => a.store.localeCompare(b.store));

  const list = rows.filter((r) =>
    tab === "followup" ? r.needs_followup && !r.followup_done_at : tab === "all" ? true : r.kind === tab
  );
  const openFollowups = rows.filter((r) => r.needs_followup && !r.followup_done_at).length;

  const card = "rounded-3xl bg-white soft-card ring-1 ring-black/5";

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-[linear-gradient(90deg,#ff5e79,#8883d7,#f39237,#0fa8bf)]" aria-hidden />
        <h1 className="text-3xl font-bold">Customer Feedback</h1>
        <p className="mt-2 text-sm text-black/60">
          Ratings from the sales, service and complaint-handling forms
          {scope.allStores ? " — all stores" : staff.storeName ? ` — ${staff.storeName}` : ""}. Ratings of 2 or less,
          products not working and complaints not resolved need a follow-up.
        </p>
      </div>

      {error && (
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          Feedback is not set up in the database yet. Ask the Super Admin to run the latest database update.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {[7, 30, 90, 365].map((d) => (
          <Link
            key={d}
            href={`/staff/feedback?tab=${tab}&days=${d}`}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${d === days ? "bg-[#161616] text-white" : "bg-white ring-1 ring-black/10"}`}
          >
            {d === 365 ? "1 year" : `${d} days`}
          </Link>
        ))}
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-black/5 text-[11px] uppercase tracking-wider text-black/45">
            <tr>
              <th className="px-5 py-3.5 text-left">Store</th>
              {(
                [
                  ["sales", "Sales"],
                  ["service", "Service"],
                  ["complaint", "Complaint handling"],
                  ["followup", "Open follow-ups"],
                ] as const
              ).map(([k, l]) => (
                <th key={k} className="px-5 py-3.5 text-center">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: KIND_COLOUR[k] }} />
                    {l}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {summary.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-black/50">
                  No ratings in this period yet.
                </td>
              </tr>
            ) : (
              summary.map((s) => (
                <tr key={s.store}>
                  <td className="px-5 py-3 font-semibold">{s.store}</td>
                  {[s.sales, s.service, s.complaint].map((l, i) => {
                    const a = avgNum(l.map((r) => r.overall));
                    return (
                      <td key={i} className="px-5 py-3 text-center">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 font-bold ${ratingStyle(a)}`}>
                          {a === null ? "—" : `★ ${a.toFixed(1)}`}
                        </span>
                        <span className="text-xs text-black/40"> ({l.length})</span>
                      </td>
                    );
                  })}
                  <td className={`px-5 py-3 text-center font-bold ${s.followups ? "text-[#d43852]" : "text-black/40"}`}>
                    {s.followups}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={`/staff/feedback?tab=${t.value}&days=${days}`}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
              t.value === tab ? "bg-[#161616] text-white shadow-sm" : "bg-white text-black/60 ring-1 ring-black/10 hover:text-black"
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: KIND_COLOUR[t.value] === "#161616" && t.value === tab ? "#fff" : KIND_COLOUR[t.value] }} />
            {t.label}
            {t.value === "followup" && openFollowups > 0 ? ` (${openFollowups})` : ""}
          </Link>
        ))}
      </div>

      {list.length === 0 ? (
        <p className={`${card} p-6 text-center text-sm text-black/55`}>
          {tab === "followup" ? "Nothing waiting for a follow-up. 🎉" : "No feedback here yet."}
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((r) => {
            const questions = feedbackQuestions(r.kind, r.confidential);
            const ticketHref =
              r.kind === "service"
                ? `/staff/service/${r.ref_id}`
                : `/staff/complaints/${r.ref_id}`;
            return (
              <li key={r.id} className={`${card} relative overflow-hidden p-5 pl-6`}>
                <span className="absolute inset-y-4 left-0 w-1 rounded-r-full" style={{ backgroundColor: KIND_COLOUR[r.kind] }} aria-hidden />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: KIND_COLOUR[r.kind] }}>
                      {FORM_TITLES[r.kind]}
                      {r.confidential ? " · Confidential (HR)" : ""}
                    </p>
                    {r.kind === "sales" ? (
                      <p className="mt-1 font-mono text-sm font-bold">Bill {r.ref_number}</p>
                    ) : (
                      <Link href={ticketHref} className="mt-1 block font-mono text-sm font-bold hover:underline">
                        {r.ref_number}
                      </Link>
                    )}
                    <p className="text-xs text-black/50">
                      {[r.store_name, r.staff_name && !r.confidential ? `Staff: ${r.staff_name}` : null, r.confidential ? null : r.mobile]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`inline-block rounded-2xl px-3 py-1 text-2xl font-bold ${ratingStyle(r.overall)}`}>
                      {r.overall === null ? "—" : `★ ${r.overall}`}
                    </p>
                    <p className="text-xs text-black/40">{formatDateTime(r.created_at)}</p>
                  </div>
                </div>

                <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {r.kind === "complaint" && r.resolved && (
                    <div>
                      <dt className="text-xs text-black/45">Has your complaint been resolved?</dt>
                      <dd className={`font-semibold ${r.resolved === "yes" ? "text-green-700" : "text-[#d43852]"}`}>
                        {answerLabel(r.resolved)}
                      </dd>
                    </div>
                  )}
                  {questions
                    .filter((q) => q.type !== "comment" && r.answers && r.answers[q.id] !== undefined)
                    .map((q) => {
                      const v = r.answers?.[q.id];
                      const bad = (typeof v === "number" && v <= 2) || v === "no" || v === "partly";
                      return (
                        <div key={q.id}>
                          <dt className="text-xs text-black/45">{q.label}</dt>
                          <dd className={`font-semibold ${bad ? "text-[#d43852]" : ""}`}>{answerLabel(v)}</dd>
                        </div>
                      );
                    })}
                </dl>
                {r.comment && <p className="mt-3 rounded-2xl bg-[#f7f9fb] p-3 text-sm">“{r.comment}”</p>}

                {r.needs_followup && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
                    {r.followup_done_at ? (
                      <p className="text-xs text-green-700">
                        ✓ Followed up by {r.followup_by} · {formatDateTime(r.followup_done_at)}
                        {r.followup_note ? ` — ${r.followup_note}` : ""}
                      </p>
                    ) : (
                      <>
                        <span className="rounded-full bg-[#ff5e79]/10 px-3 py-1 text-xs font-bold text-[#d43852]">Needs follow-up</span>
                        {scope.canMarkDone && <FeedbackFollowUp id={r.id} />}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
