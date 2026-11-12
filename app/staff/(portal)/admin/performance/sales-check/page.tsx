import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { formatDate, formatDateTime, todayISO } from "@/lib/helpers";
import { savedDaily } from "@/lib/reconcile";
import { loadSyncLog } from "@/lib/sync-log";
import { DayActions } from "@/components/SalesCheck";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales check" };

const rs = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const th = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-black/45";
const td = "whitespace-nowrap px-3 py-2 tabular-nums";

export default async function SalesCheckPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (!isAdmin(staff.role)) redirect("/staff");
  const sp = await searchParams;
  const today = todayISO();
  const from = isDay(sp.from) ? sp.from! : `${today.slice(0, 7)}-01`;
  const to = isDay(sp.to) ? sp.to! : today;
  const [rows, log] = await Promise.all([savedDaily(from, to), loadSyncLog()]);
  const dates = [...new Set(rows.map((r) => r.date))];
  const stores = [...new Set(rows.map((r) => r.store))].sort();
  const totals = stores.map((s) => {
    const xs = rows.filter((r) => r.store === s);
    return { store: s, bills: xs.reduce((a, r) => a + r.bills, 0), billed: xs.reduce((a, r) => a + r.billed, 0), returns: xs.reduce((a, r) => a + r.returns, 0), returned: xs.reduce((a, r) => a + r.returned, 0) };
  });
  const lastOk = log.find((r) => r.kind === "scheduled" && r.status !== "failed");
  const lastFail = log.find((r) => r.status === "failed");
  const fresh = lastOk && Date.now() - Date.parse(lastOk.at) < 75 * 60_000;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">Settings</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Sales check (Zoho POS → dashboard)</h1>
          <p className="mt-1 max-w-3xl text-sm text-black/55">
            <b>Billed</b> = bill totals with GST — the sales figure Zoho POS shows. <b>Returns</b> = credit notes with GST. <b>Net</b> = Billed − Returns — what the dashboard shows
            (discounts are already inside the bill totals). Void and draft bills are not counted.
          </p>
        </div>
        <Link href="/staff/admin/performance" className="rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-black/5">
          ← Settings
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 soft-card ring-1 ring-black/5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">Automatic copy (every 30 min)</p>
          <p className={`mt-1 text-lg font-bold ${fresh ? "text-green-700" : "text-[#d6224a]"}`}>{lastOk ? (fresh ? "Running" : "Late") : "No run logged yet"}</p>
          <p className="text-xs text-black/55">{lastOk ? `Last good run ${formatDateTime(lastOk.at)}` : "Runs are logged from now on."}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 soft-card ring-1 ring-black/5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">Last problem</p>
          <p className="mt-1 text-sm font-semibold">{lastFail ? formatDateTime(lastFail.at) : "None logged"}</p>
          <p className="text-xs text-black/55">{lastFail?.error ?? ""}</p>
        </div>
        <form className="rounded-2xl bg-white p-4 soft-card ring-1 ring-black/5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">Dates</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <input type="date" name="from" defaultValue={from} className="rounded-xl border border-black/10 px-2 py-1" />
            to
            <input type="date" name="to" defaultValue={to} max={today} className="rounded-xl border border-black/10 px-2 py-1" />
            <button className="rounded-full bg-[#161616] px-3 py-1 font-semibold text-white">Show</button>
          </div>
        </form>
      </div>

      <section className="rounded-3xl bg-white p-4 soft-card ring-1 ring-black/5 sm:p-5">
        <h2 className="mb-2 text-lg font-bold">
          Totals {formatDate(from)} – {formatDate(to)}
        </h2>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr>
                <th className={th}>Store</th>
                <th className={`${th} text-right`}>Bills</th>
                <th className={`${th} text-right`}>Billed (= Zoho sales)</th>
                <th className={`${th} text-right`}>Returns</th>
                <th className={`${th} text-right`}>Net (dashboard)</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => (
                <tr key={t.store} className="border-t border-black/5">
                  <td className={`${td} font-semibold`}>{t.store}</td>
                  <td className={`${td} text-right`}>{t.bills}</td>
                  <td className={`${td} text-right`}>{rs(t.billed)}</td>
                  <td className={`${td} text-right`}>
                    − {rs(t.returned)} <span className="text-xs text-black/45">({t.returns})</span>
                  </td>
                  <td className={`${td} text-right font-bold`}>{rs(t.billed - t.returned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-4 soft-card ring-1 ring-black/5 sm:p-5">
        <h2 className="mb-2 text-lg font-bold">Day by day</h2>
        <p className="mb-3 text-xs text-black/55">“Check with Zoho” reads only the day’s bill and return lists (1–2 requests each) and lists any bill that differs.</p>
        <div className="space-y-3">
          {dates.map((d) => (
            <div key={d} className="rounded-2xl p-3 ring-1 ring-black/5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-sm">
                  <p className="font-bold">{formatDate(d)}</p>
                  {rows
                    .filter((r) => r.date === d)
                    .map((r) => (
                      <p key={r.store} className="tabular-nums">
                        <span className="font-semibold">{r.store}</span>: {r.bills} bills {rs(r.billed)} − {r.returns} returns {rs(r.returned)} = <b>{rs(r.net)}</b>
                        <span className="text-xs text-black/45"> · copied {r.lastSynced ? formatDateTime(r.lastSynced) : "—"}</span>
                      </p>
                    ))}
                </div>
                <DayActions date={d} />
              </div>
            </div>
          ))}
          {!dates.length && <p className="text-sm text-black/55">No bills saved for these dates.</p>}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-4 soft-card ring-1 ring-black/5 sm:p-5">
        <h2 className="mb-2 text-lg font-bold">Copy log</h2>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>Kind</th>
                <th className={th}>Status</th>
                <th className={th}>Days (bills in Zoho / read now / pending)</th>
                <th className={th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {log.slice(0, 40).map((r, i) => (
                <tr key={i} className="border-t border-black/5 align-top">
                  <td className={td}>{formatDateTime(r.at)}</td>
                  <td className={td}>
                    {r.kind}
                    {r.by ? ` · ${r.by}` : ""}
                    {r.retried ? " · retried" : ""}
                  </td>
                  <td className={`${td} font-semibold ${r.status === "ok" ? "text-green-700" : r.status === "partial" ? "text-amber-700" : "text-[#d6224a]"}`}>{r.status}</td>
                  <td className="px-3 py-2 text-xs">{r.days.map((d) => `${d.date.slice(5)}: ${d.bills}/${d.billsSaved + d.returnsSaved}/${d.pending}`).join(" · ")}</td>
                  <td className="max-w-[320px] px-3 py-2 text-xs text-black/60">{r.error ?? ""}</td>
                </tr>
              ))}
              {!log.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-sm text-black/55">
                    No runs logged yet — every copy is logged from now on.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
