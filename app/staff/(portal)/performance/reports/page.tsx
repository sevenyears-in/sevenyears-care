import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate, formatDateTime, todayISO } from "@/lib/helpers";
import { rupees } from "@/lib/performance-rules";
import { monthReport } from "@/lib/performance";
import { merchStores } from "@/lib/merch-access";
import { eodBlock, loadEodReports, type EodRow } from "@/lib/eod-report";
import { RegenerateEod } from "@/components/RegenerateEod";
import { ReportBody } from "@/components/ReportBody";
import { parseReport } from "@/lib/report-parse";

export const dynamic = "force-dynamic";
export const metadata = { title: "End-of-day reports" };

type Search = { day?: string; store?: string };
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
const BADGE: Record<EodRow["status"], string> = {
  final: "bg-green-50 text-green-700",
  provisional: "bg-amber-100 text-amber-800",
  generating: "bg-black/5 text-black/50",
  failed: "bg-red-50 text-red-700",
};

export default async function EodReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  const sp = await searchParams;
  const report = await monthReport(todayISO().slice(0, 7)).catch(() => null);
  const stores = await merchStores(staff, (report?.stores ?? []).map((s) => s.store));
  if (!stores.length) redirect("/staff/performance");
  const rows = await loadEodReports(stores, 90);
  const pick = rows.find((r) => r.day === sp.day && r.store === (sp.store ?? "").toUpperCase()) ?? rows[0] ?? null;
  const d = pick?.data ?? null;
  const superAdmin = staff.role === "super_admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">My Performance</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">End-of-day reports</h1>
          <p className="mt-1 text-sm text-black/55">
            Made after closing time and the last copy from Zoho POS. “Provisional” means the copy after closing had not worked yet; it is made again and marked final once it does.
          </p>
        </div>
        <Link href="/staff/performance?view=team" className="rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-black/5">
          ← Dashboard
        </Link>
      </div>

      {superAdmin && <RegenerateEod stores={stores} today={todayISO()} />}

      {!rows.length ? (
        <p className="rounded-3xl bg-white p-6 text-sm text-black/55 soft-card ring-1 ring-black/5">
          No reports yet. They are made each evening once end-of-day reports are switched on (Settings → Sales alerts &amp; reports).
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <ul className="max-h-[70vh] divide-y divide-black/5 overflow-auto rounded-3xl bg-white soft-card ring-1 ring-black/5">
            {rows.map((r) => {
              const on = pick && r.day === pick.day && r.store === pick.store;
              return (
                <li key={`${r.day}|${r.store}`}>
                  <Link
                    href={`/staff/performance/reports?day=${r.day}&store=${encodeURIComponent(r.store)}`}
                    className={`flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-black/[0.03] ${on ? "bg-[#8883d7]/10" : ""}`}
                  >
                    <span>
                      <b>{formatDate(r.day)}</b> · {r.store}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${BADGE[r.status]}`}>{r.status}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {pick && (
            <section className="space-y-4 rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold">
                  {pick.store} · {formatDate(pick.day)}
                </h2>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${BADGE[pick.status]}`}>{pick.status}</span>
              </div>
              {pick.status === "failed" && <p className="text-sm text-red-700">Could not be made: {pick.error}</p>}
              {d && (
                <>
                  <div className="max-w-md">
                    <ReportBody segs={parseReport(eodBlock(d).join("\n")) ?? []} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["Net sales", rupees(d.net)],
                      ["Bills", String(d.bills)],
                      ["Average bill", d.bills ? rupees(d.abv) : "—"],
                      ["Day target", d.dayTarget ? `${pct(d.achievement)} of ${rupees(d.dayTarget)}` : "—"],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-2xl bg-black/[0.03] p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">{k}</p>
                        <p className="mt-1 text-lg font-bold tabular-nums">{v}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-black/65">
                    Billed {rupees(d.billed)} − returns {rupees(d.returned)}
                    {d.upb !== null ? ` · ${d.upb.toFixed(1)} items per bill` : ""}
                    {d.prevNet !== null ? ` · previous day ${rupees(d.prevNet)}` : ""}
                    {d.monthNet !== null ? ` · month so far ${rupees(d.monthNet)}${d.monthTarget ? ` (${pct(d.monthAchievement)} of ${rupees(d.monthTarget)}, ${d.daysLeft} day(s) left)` : ""}` : ""}
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {d.people && (
                      <div>
                        <h3 className="text-sm font-bold">Team</h3>
                        <ul className="mt-1 text-sm">
                          {d.people.map((p) => (
                            <li key={p.name} className="flex justify-between border-b border-black/5 py-1">
                              <span>{p.name}</span>
                              <span className="tabular-nums">
                                {rupees(p.net)} · {p.bills}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {!!d.noSales?.length && <p className="mt-2 text-xs text-black/55">No bills: {d.noSales.join(", ")}</p>}
                        {d.teamAsAt && <p className="mt-1 text-[11px] text-black/40">Team figures as at {formatDateTime(d.teamAsAt)}</p>}
                      </div>
                    )}
                    <div>
                      <h3 className="text-sm font-bold">Top categories</h3>
                      <ul className="mt-1 text-sm">
                        {d.categories.map((c) => (
                          <li key={c.name} className="flex justify-between border-b border-black/5 py-1">
                            <span>{c.name}</span>
                            <span className="tabular-nums">
                              {rupees(c.net)} · {c.units}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <h3 className="mt-3 text-sm font-bold">Top products</h3>
                      <ul className="mt-1 text-sm">
                        {d.products.map((p) => (
                          <li key={p.name} className="flex justify-between gap-2 border-b border-black/5 py-1">
                            <span className="truncate">{p.name}</span>
                            <span className="tabular-nums">
                              {rupees(p.net)} · {p.units}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {d.stock && (
                    <p className="text-sm">
                      Stock: <b>{d.stock.lowFast}</b> fast mover(s) low, <b>{d.stock.out}</b> out of stock (sold in the last 60 days).{" "}
                      <Link href="/staff/performance/stock" className="font-semibold text-[#5b55c4] underline">
                        Open stock
                      </Link>
                    </p>
                  )}
                </>
              )}
              <p className="text-[11px] text-black/45">
                {pick.generated_at ? `Made ${formatDateTime(pick.generated_at)}` : ""}
                {pick.regenerated_at ? ` · made again ${formatDateTime(pick.regenerated_at)}` : ""}
                {pick.email_result ? ` · e-mailed to ${pick.email_result.sent}${pick.email_result.failed ? `, ${pick.email_result.failed} failed` : ""}${pick.email_result.skipped ? `, ${pick.email_result.skipped} skipped (no e-mail / e-mail off)` : ""}` : ""}
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
