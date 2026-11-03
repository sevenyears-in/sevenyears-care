import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import {
  canRequestExplanation,
  explanationsForStaff,
  explanationsRequestedBy,
  explanationState,
  latestExplanations,
  type Explanation,
} from "@/lib/explanations";
import { formatDateTime } from "@/lib/helpers";
import { isCorporateStaff, STAFF_COMPLAINT_ROLES } from "@/lib/roles";
import { ExplanationsPanel } from "@/components/ExplanationsPanel";
import { supabaseAdmin } from "@/lib/supabase/server";
import { complaintKind } from "@/lib/sla";

// Every staff member: explanations asked from me (complaints about my sales, delays, SOP issues).
export default async function MyExplanationsPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");

  const canAsk = canRequestExplanation(staff.role);
  const overview = isCorporateStaff(staff) || staff.role === "hr_head" || staff.role === "hr_executive";
  const [all, askedByMe, everyone] = await Promise.all([
    explanationsForStaff(staff.id),
    canAsk ? explanationsRequestedBy(staff.id) : Promise.resolve([] as Explanation[]),
    overview ? latestExplanations() : Promise.resolve([] as Explanation[]),
  ]);

  // Staff behaviour complaints are confidential: the person it's about can reply but not open the complaint.
  const complaintIds = [
    ...new Set([...all, ...askedByMe, ...everyone].filter((e) => e.ticketType === "complaint").map((e) => e.ticketId)),
  ];
  const { data: cats } = complaintIds.length
    ? await supabaseAdmin.from("complaints").select("id, category").in("id", complaintIds)
    : { data: [] as { id: string; category: string }[] };
  const confidential = new Set((cats ?? []).filter((c) => complaintKind(c.category) === "staff").map((c) => String(c.id)));
  const pending = all.filter((e) => !e.explainedAt);
  const done = all.filter((e) => e.explainedAt);

  const group = (list: typeof all) => {
    const map = new Map<string, typeof all>();
    for (const e of list) {
      const key = `${e.ticketType}:${e.ticketId}`;
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.values()];
  };

  const section = (title: string, list: typeof all, empty: string) => (
    <section className="space-y-3">
      <h2 className="text-xl font-bold">{title}</h2>
      {list.length === 0 ? (
        <p className="rounded-3xl bg-white p-5 text-sm text-black/55 soft-card ring-1 ring-black/5">{empty}</p>
      ) : (
        group(list).map((items) => {
          const first = items[0];
          const href = `/staff/${first.ticketType === "service" ? "service" : "complaints"}/${first.ticketId}`;
          return (
            <div key={`${first.ticketType}:${first.ticketId}`} className="space-y-2">
              {confidential.has(first.ticketId) ? (
                <p className="font-mono text-sm font-bold text-black/60">{first.ticketNumber} — staff behaviour complaint (confidential, handled by HR)</p>
              ) : (
                <Link href={href} className="font-mono text-sm font-bold text-[#11b8d0] hover:underline">
                  {first.ticketNumber} — open the {first.ticketType === "service" ? "service request" : "complaint"} →
                </Link>
              )}
              <ExplanationsPanel
                type={first.ticketType}
                ticketId={first.ticketId}
                currentStaffId={staff.id}
                canAsk={false}
                explanations={items}
                people={[]}
                suggestedStaffId={null}
              />
            </div>
          );
        })
      )}
    </section>
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Explanations</h1>
        <p className="mt-2 text-sm text-black/60">
          When a customer complains about a sale you made, or a manager or Director asks about a delay, you are asked to
          give your side here. Only staff can see your reply.
        </p>
      </div>
      {section("Waiting for your reply", pending, "Nothing is waiting for you. 🎉")}
      {done.length > 0 && section("Already replied", done, "None yet.")}
      {canAsk && (
        <Overview
          title="Asked by me"
          empty="You haven't asked anyone yet. Open a service request or complaint and use “Ask someone to explain”."
          list={askedByMe}
          confidential={confidential}
          canSeeConfidential={STAFF_COMPLAINT_ROLES.includes(staff.role) || staff.role === "hr_head"}
        />
      )}
      {overview && (
        <Overview
          title="All stores — latest explanations"
          empty="No explanations yet."
          list={everyone}
          confidential={confidential}
          canSeeConfidential={STAFF_COMPLAINT_ROLES.includes(staff.role)}
        />
      )}
    </div>
  );
}

function Overview({
  title,
  empty,
  list,
  confidential,
  canSeeConfidential,
}: {
  title: string;
  empty: string;
  list: Explanation[];
  confidential: Set<string>;
  canSeeConfidential: boolean;
}) {
  const visible = list.filter((e) => canSeeConfidential || !confidential.has(e.ticketId));
  const waiting = visible.filter((e) => !e.explainedAt).length;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-bold">{title}</h2>
        {visible.length > 0 && (
          <p className="text-xs font-semibold text-black/50">
            {waiting} waiting · {visible.length - waiting} replied
          </p>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="soft-card rounded-3xl bg-white p-5 text-sm text-black/55 ring-1 ring-black/5">{empty}</p>
      ) : (
        <ul className="soft-card divide-y divide-black/5 overflow-hidden rounded-3xl bg-white ring-1 ring-black/5">
          {visible.map((e) => (
            <li key={e.id} className="relative px-5 py-4 pl-6">
              <span
                className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${e.explainedAt ? "bg-green-500" : "bg-amber-400"}`}
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/staff/${e.ticketType === "service" ? "service" : "complaints"}/${e.ticketId}`}
                  className="font-mono text-xs font-bold text-[#11b8d0] hover:underline"
                >
                  {e.ticketNumber}
                </Link>
                {confidential.has(e.ticketId) && (
                  <span className="rounded-full bg-[#8883d7]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[#5c57b0]">
                    HR · confidential
                  </span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    !e.explainedAt
                      ? "bg-amber-50 text-amber-800"
                      : explanationState(e) === "withdrawn"
                        ? "bg-black/5 text-black/50"
                        : explanationState(e) === "recorded"
                          ? "bg-sky-50 text-sky-700"
                          : "bg-green-50 text-green-700"
                  }`}
                >
                  {{ waiting: "Waiting", replied: "Replied", recorded: "Recorded", withdrawn: "Withdrawn" }[explanationState(e)]}
                </span>
              </div>
              <p className="mt-1.5 text-sm">
                <span className="font-semibold">{e.staffName}</span>
                <span className="text-black/50"> — asked by {e.requestedByName ?? "System"} · {formatDateTime(e.requestedAt)}</span>
              </p>
              <p className="mt-1 text-sm text-black/65">
                <span className="font-semibold">Asked:</span> {e.reason}
              </p>
              {e.explanation && (
                <p className="mt-2 whitespace-pre-line rounded-2xl bg-[#f7f9fb] p-3 text-sm">
                  {e.explanation}
                  <span className="mt-1 block text-xs text-black/45">Replied {formatDateTime(e.explainedAt)}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
