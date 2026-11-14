import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/helpers";
import { rupees } from "@/lib/performance-rules";
import { monthReport } from "@/lib/performance";
import { merchStores } from "@/lib/merch-access";
import { dailySales, type DailyRow } from "@/lib/daily-sales";

export const dynamic = "force-dynamic";
export const metadata = { title: "Day-wise sales" };

type Search = { from?: string; to?: string; store?: string };
const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const th = "whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-black/45";
const td = "whitespace-nowrap px-3 py-2 tabular-nums";
const STATE: Record<DailyRow["state"], { text: string; cls: string }> = {
  live: { text: "Live", cls: "bg-[#0b7f91]/15 text-[#0b7f91]" },
  provisional: { text: "Provisional", cls: "bg-amber-100 text-amber-800" },
  special: { text: "Holiday / special", cls: "bg-black/5 text-black/50" },
  closed: { text: "Closed", cls: "bg-green-50 text-green-700" },
};

export default async function DailySalesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  const sp = await searchParams;
  const today = todayISO();
  const report = await monthReport(today.slice(0, 7)).catch(() => null);
  const allStores = (report?.stores ?? []).map((s) => s.store);
  const stores = await merchStores(staff, allStores);
  if (!stores.length) redirect("/staff/performance");
  const to = isDay(sp.to) && sp.to! <= today ? sp.to! : today;
  // Opens on this month; "Last 7 days" and the date boxes still choose any range.
  const from = isDay(sp.from) && sp.from! <= to ? sp.from! : `${to.slice(0, 8)}01`;
  const want = (sp.store ?? "").toUpperCase();
  const consolidated = stores.length > 1 && (want === "ALL" || !want);
  const chosen = consolidated ? stores : stores.includes(want) ? [want] : [stores[0]];
  const rows = await dailySales(from, to, chosen, consolidated);
  const shown = rows;
  // Days with no sales data yet (not copied from Zoho, nothing uploaded) are left out of the totals.
  const closed = shown.filter((r) => r.state === "closed" && !r.noData && !r.partial);
  const missingDays = shown.filter((r) => r.noData || r.partial).length;
  const total = closed.reduce((a, r) => ({ net: a.net + r.net, target: a.target + r.target, bills: a.bills + r.bills }), { net: 0, target: 0, bills: 0 });
  const max = Math.max(1, ...shown.map((r) => Math.max(r.net, r.target)));
  const chart = [...shown].reverse();
  const qs = (c: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ from, to, store: consolidated ? "ALL" : chosen[0], ...c })) if (v) p.set(k, v);
    return `/staff/performance/daily?${p}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">My Performance</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Day-wise sales · {consolidated ? "All stores" : chosen[0]}</h1>
          <p className="mt-1 text-sm text-black/55">Net = billed with GST − returns. Daily target = the month’s store target ÷ days in the month.</p>
        </div>
        <Link href="/staff/performance?view=team" className="rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-black/5">
          ← Dashboard
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 text-sm soft-card ring-1 ring-black/5">
        <label>
          <span className="block text-[11px] font-bold uppercase tracking-wide text-black/45">From</span>
          <input type="date" name="from" defaultValue={from} max={today} className="rounded-xl border border-black/10 px-2 py-1.5" />
        </label>
        <label>
          <span className="block text-[11px] font-bold uppercase tracking-wide text-black/45">To</span>
          <input type="date" name="to" defaultValue={to} max={today} className="rounded-xl border border-black/10 px-2 py-1.5" />
        </label>
        <label>
          <span className="block text-[11px] font-bold uppercase tracking-wide text-black/45">Store</span>
          <select name="store" defaultValue={consolidated ? "ALL" : chosen[0]} className="rounded-xl border border-black/10 px-2 py-1.5">
            {stores.length > 1 && <option value="ALL">All stores (together)</option>}
            {stores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-full bg-[#161616] px-4 py-2 font-semibold text-white">Show</button>
        <div className="ml-auto flex gap-2">
          <Link href={qs({ from: `${today.slice(0, 7)}-01`, to: today })} className="rounded-full px-3 py-1.5 font-semibold ring-1 ring-black/10 hover:bg-black/5">
            This month
          </Link>
          <Link href={qs({ from: addDays(today, -6), to: today })} className="rounded-full px-3 py-1.5 font-semibold ring-1 ring-black/10 hover:bg-black/5">
            Last 7 days
          </Link>
        </div>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 soft-card ring-1 ring-black/5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">Net sales (closed days)</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{rupees(total.net)}</p>
          <p className="text-xs text-black/55">
            {closed.length} closed day(s) · {total.bills} bills
            {missingDays ? ` · ${missingDays} day(s) with no data yet left out` : ""}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 soft-card ring-1 ring-black/5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">Target (same days)</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{rupees(total.target)}</p>
          <p className="text-xs text-black/55">{total.target ? `${Math.round((total.net / total.target) * 100)}% achieved` : "No target set"}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 soft-card ring-1 ring-black/5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">Average a day</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{rupees(closed.length ? total.net / closed.length : 0)}</p>
          <p className="text-xs text-black/55">Closed days only</p>
        </div>
        <div className="rounded-2xl bg-white p-4 soft-card ring-1 ring-black/5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">Days on target</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {closed.filter((r) => r.achievement !== null && r.achievement >= 1).length} / {closed.length}
          </p>
          <p className="text-xs text-black/55">Daily target reached</p>
        </div>
      </div>

      <section className="rounded-3xl bg-white p-4 soft-card ring-1 ring-black/5 sm:p-5">
        <h2 className="text-lg font-bold">Trend</h2>
        <p className="text-xs text-black/50">Bars = net sales a day; line = daily target. Teal = today (live), amber = provisional, grey = no data yet.</p>
        <div className="mt-3 flex h-44 items-end gap-[3px] overflow-x-auto">
          {chart.map((r) => (
            <div key={`${r.date}-${r.store}`} className="relative flex h-full min-w-[10px] flex-1 flex-col justify-end" title={`${formatDate(r.date)}: ${rupees(r.net)} (target ${rupees(r.target)})`}>
              {r.target > 0 && <div className="absolute left-0 right-0 border-t-2 border-dashed border-black/30" style={{ bottom: `${(r.target / max) * 100}%` }} />}
              <div
                className={`w-full rounded-t ${r.noData ? "bg-black/10" : r.state === "live" ? "bg-[#0b7f91]" : r.state === "provisional" ? "bg-amber-400" : r.achievement !== null && r.achievement >= 1 ? "bg-green-500" : "bg-[#8883d7]"}`}
                style={{ height: `${r.noData ? 2 : Math.max(1, (r.net / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-black/45">
          <span>{chart[0] ? formatDate(chart[0].date) : ""}</span>
          <span>{chart.length ? formatDate(chart[chart.length - 1].date) : ""}</span>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-4 soft-card ring-1 ring-black/5 sm:p-5">
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Store</th>
                <th className={`${th} text-right`}>Bills</th>
                <th className={`${th} text-right`}>Billed</th>
                <th className={`${th} text-right`}>Returns</th>
                <th className={`${th} text-right`}>Net sales</th>
                <th className={`${th} text-right`}>Daily target</th>
                <th className={`${th} text-right`}>Achieved</th>
                <th className={`${th} text-right`}>Variance</th>
                <th className={`${th} text-right`}>vs day before</th>
                <th className={th}>Day</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) =>
                r.noData ? (
                  <tr key={`${r.date}-${r.store}`} className="border-t border-black/5 text-black/40">
                    <td className={td}>
                      {formatDate(r.date)} <span className="text-xs">{new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}</span>
                    </td>
                    <td className={td}>{r.store === "ALL" ? "All stores" : r.store}</td>
                    <td className={`${td} text-center`} colSpan={8}>
                      Not copied from Zoho POS yet — filled in by the nightly copy (or an Excel upload)
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-bold text-black/50">No data yet</span>
                    </td>
                  </tr>
                ) : (
                <tr key={`${r.date}-${r.store}`} className="border-t border-black/5">
                  <td className={td}>
                    {formatDate(r.date)} <span className="text-xs text-black/40">{new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}</span>
                  </td>
                  <td className={td}>{r.store === "ALL" ? "All stores" : r.store}</td>
                  <td className={`${td} text-right`}>{r.bills}</td>
                  <td className={`${td} text-right`}>{rupees(r.billed)}</td>
                  <td className={`${td} text-right text-black/60`}>{r.returned ? `− ${rupees(r.returned)}` : "—"}</td>
                  <td className={`${td} text-right font-semibold`}>{rupees(r.net)}</td>
                  <td className={`${td} text-right text-black/60`}>{r.target ? rupees(r.target) : "—"}</td>
                  <td className={`${td} text-right font-semibold ${r.achievement === null ? "" : r.achievement >= 1 ? "text-green-700" : "text-[#d6224a]"}`}>{r.achievement === null ? "—" : `${Math.round(r.achievement * 100)}%`}</td>
                  <td className={`${td} text-right ${r.variance >= 0 ? "text-green-700" : "text-[#d6224a]"}`}>{r.target ? `${r.variance >= 0 ? "+" : "−"}${rupees(Math.abs(r.variance))}` : "—"}</td>
                  <td className={`${td} text-right`}>{r.change === null ? "—" : <span className={r.change >= 0 ? "text-green-700" : "text-[#d6224a]"}>{r.change >= 0 ? "▲" : "▼"} {Math.abs(Math.round(r.change * 100))}%</span>}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE[r.state].cls}`}>{STATE[r.state].text}</span>
                    {r.partial && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">Some stores missing</span>}
                    {r.fromUpload && <span className="ml-1 rounded-full bg-[#8883d7]/15 px-2 py-0.5 text-[11px] font-bold text-[#5b55c4]">Uploaded</span>}
                  </td>
                </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
