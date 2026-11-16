import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/helpers";
import { monthReport } from "@/lib/performance";
import { merchStores } from "@/lib/merch-access";
import { clockIST, loadOpenCloseHistory, type OpenClose, type Sop } from "@/lib/store-open-close";
import { ApproveSop } from "@/components/ApproveSop";

export const dynamic = "force-dynamic";
export const metadata = { title: "Store opening & closing" };

const BADGE: Record<Sop, { text: string; cls: string }> = {
  ok: { text: "As per SOP", cls: "bg-green-50 text-green-700" },
  violation: { text: "SOP violation", cls: "bg-red-100 text-red-800" },
  approved: { text: "Approved", cls: "bg-amber-100 text-amber-800" },
};

function Cell({ r, kind, canApprove }: { r: OpenClose; kind: "open" | "close"; canApprove: boolean }) {
  const at = kind === "open" ? r.openedAt : r.closedAt;
  const by = kind === "open" ? r.openedBy : r.closedBy;
  const sop = kind === "open" ? r.openSop : r.closeSop;
  const approval = kind === "open" ? r.openApproval : r.closeApproval;
  if (!at) return <td className="px-3 py-2 text-black/40">—</td>;
  return (
    <td className="px-3 py-2 align-top">
      <p className="font-semibold tabular-nums">{clockIST(at)}</p>
      {by && <p className="text-xs text-black/60">{by}</p>}
      {sop && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${BADGE[sop].cls}`}>{BADGE[sop].text}</span>}
      {approval && <p className="mt-0.5 text-[11px] text-black/50">Approved by {approval}</p>}
      {sop === "violation" && canApprove && (
        <div className="mt-1">
          <ApproveSop day={r.day} store={r.store} kind={kind} />
        </div>
      )}
    </td>
  );
}

export default async function OpenClosePage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  const sp = await searchParams;
  const report = await monthReport(todayISO().slice(0, 7)).catch(() => null);
  const stores = await merchStores(staff, (report?.stores ?? []).map((s) => s.store));
  if (!stores.length) redirect("/staff/performance");
  const want = (sp.store ?? "").toUpperCase();
  const store = stores.includes(want) ? want : stores[0];
  const rows = await loadOpenCloseHistory(store, 60).catch(() => []);
  const canApprove = staff.role === "director" || staff.role === "super_admin";
  const violations = rows.filter((r) => r.openSop === "violation" || r.closeSop === "violation").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">My Performance</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Store opening &amp; closing · {store}</h1>
          <p className="mt-1 text-sm text-black/55">
            From the punching machine. Opening = first punch − 2 minutes; closing = last punch. As per SOP only the Store Manager or the ASM / Floor
            Manager opens and closes the store (an SM / ASM punch within a minute of the first / last punch counts). Anything else is an SOP
            violation until the Director approves it.
          </p>
        </div>
        <Link href={`/staff/performance?view=team&store=${encodeURIComponent(store)}`} className="rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-black/5">
          ← Store dashboard
        </Link>
      </div>

      {stores.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {stores.map((s) => (
            <Link
              key={s}
              href={`/staff/performance/open-close?store=${encodeURIComponent(s)}`}
              className={`rounded-full px-4 py-1.5 text-sm font-bold ${s === store ? "bg-[#8883d7] text-white" : "bg-white ring-1 ring-black/10"}`}
            >
              {s}
            </Link>
          ))}
        </div>
      )}

      {violations > 0 && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          ⚠ {violations} day(s) with an SOP violation waiting for the Director&apos;s approval.
        </p>
      )}

      <div className="overflow-x-auto rounded-3xl bg-white soft-card ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-black/[0.03] text-left text-[11px] font-bold uppercase tracking-wide text-black/50">
            <tr>
              <th className="px-3 py-2">Day</th>
              <th className="px-3 py-2">Opened</th>
              <th className="px-3 py-2">Closed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} className="border-t border-black/5">
                <td className="px-3 py-2 align-top font-semibold">{formatDate(r.day)}</td>
                <Cell r={r} kind="open" canApprove={canApprove} />
                <Cell r={r} kind="close" canApprove={canApprove} />
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-black/50">
                  No openings recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
