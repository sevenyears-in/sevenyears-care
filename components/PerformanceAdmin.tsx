"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { groupList, groupName, rupees, type IncentiveGroup, type PerformanceSettings } from "@/lib/performance-rules";
import { ruleStatus, ruleSummary, type IncentiveRule } from "@/lib/incentive-rules";
import { IncentiveRulesEditor } from "@/components/IncentiveRulesEditor";
import type { BackfillState } from "@/lib/sales-backfill";
import type { StockReadState } from "@/lib/stock";
import { ExcelImport } from "@/components/ExcelImport";

type Person = {
  id: string;
  userId: string;
  name: string;
  /** Store whose pool they share. */
  store: string | null;
  /** Store in Staff Users. */
  homeStore: string | null;
  /** Store chosen in Settings for Corporate Office staff. */
  chosenStore: string | null;
  group: IncentiveGroup;
  isPt: boolean;
};
type Promo = { id: number; kind: string; item_id: string | null; sku: string | null; name: string; from_date: string | null; to_date: string | null };
type ZItem = { item_id: string; name: string; sku: string | null; rate: number; category: string };

const btn = "rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50";
const sbtn = "rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50";
const primary = `${btn} bg-[#8883d7] text-white hover:opacity-90`;
const ghost = `${btn} bg-white ring-1 ring-black/10 hover:bg-black/5`;
const input = "w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[#8883d7]";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/staff/admin/performance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

function Card({ title, intro, actions, children }: { title: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6">
      <span className="absolute inset-y-0 left-0 w-1.5 bg-[#8883d7]" aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {intro && <p className="mt-0.5 text-sm text-black/55">{intro}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
function shiftMonth(m: string, by: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "");

export function PerformanceAdmin(props: {
  month: string;
  thisMonth: string;
  today: string;
  settings: PerformanceSettings;
  stores: string[];
  people: Person[];
  targets: Record<string, { sales: number; abv: number | null }>;
  storeMonthTargets: Record<string, number>;
  salaries: Record<string, number>;
  promos: Promo[];
  unlinked: { name: string; net: number; bills: number }[];
  billsCopied: number;
  lastBillDate: string | null;
  rules: IncentiveRule[];
  backfill: Backfill;
  stock: StockReadState | null;
  isSuperAdmin: boolean;
}) {
  const labels = props.settings.groupLabels;
  return (
    <div className="space-y-6">
      <SyncCard month={props.month} today={props.today} settings={props.settings} billsCopied={props.billsCopied} lastBillDate={props.lastBillDate} />
      <NightCopyCard backfill={props.backfill} thisMonth={props.thisMonth} />
      <StockCard stock={props.stock} isSuperAdmin={props.isSuperAdmin} zohoToday={props.backfill.zohoToday} quota={props.backfill.dailyQuota} />
      <Card title="Upload from Excel" intro="For urgent cases, or when Zoho requests are running short: upload sales (item-wise, by date) or stock on hand exported from Zoho POS.">
        <ExcelImport stores={props.stores} />
      </Card>
      {props.unlinked.length > 0 && <LinksCard unlinked={props.unlinked} people={props.people} />}
      <TargetsCard {...props} />
      <IncentiveRulesEditor rules={props.rules} today={props.today} labels={labels} groups={groupList(props.settings).filter((g) => g.key !== "none")} />
      <PromoCard promos={props.promos} rules={props.rules} today={props.today} />
      <GroupNamesCard settings={props.settings} people={props.people} />
      <SettingsCard settings={props.settings} stores={props.stores} />
    </div>
  );
}

// ------------------------------------------------------------------
// Group names
// ------------------------------------------------------------------

function GroupNamesCard({ settings, people }: { settings: PerformanceSettings; people: Person[] }) {
  const router = useRouter();
  const groups = groupList(settings);
  const [renaming, setRenaming] = useState<{ key: string; name: string } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await post(body);
      setRenaming(null);
      setAdding(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  const count = (key: string) => people.filter((p) => p.group === key).length;
  const targetMode = (key: string) => (settings.noTargetGroups.includes(key) ? "store" : settings.poolOnlyGroups.includes(key) ? "pool" : "own");
  return (
    <Card
      title="Groups"
      intro="The groups decide who shares which part of the store pool and who can earn each incentive."
      actions={
        adding === null && !renaming ? (
          <button className={primary} onClick={() => setAdding("")}>
            + Add group
          </button>
        ) : undefined
      }
    >
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[680px] table-fixed text-sm">
          <colgroup>
            <col />
            <col className="w-28" />
            <col className="w-52" />
            <col className="w-24" />
            <col className="w-48" />
          </colgroup>
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-black/45">
              <th className="px-2 py-2">Group</th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2">Sales target</th>
              <th className="px-2 py-2 text-right">People</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-t border-black/5">
                <td className="px-2 py-2.5">
                  {renaming?.key === g.key ? (
                    <input className={`${input} py-1`} maxLength={40} value={renaming.name} onChange={(e) => setRenaming({ key: g.key, name: e.target.value })} autoFocus />
                  ) : (
                    <span className={`font-semibold ${g.key === "none" ? "text-black/50" : ""}`}>{g.label}</span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-xs text-black/50">{g.custom ? "Added" : "Standard"}</td>
                <td className="px-2 py-2.5">
                  {g.key === "none" ? (
                    <span className="text-xs text-black/35">—</span>
                  ) : (
                    <select
                      className={`${input} py-1 text-xs`}
                      disabled={busy || !!renaming || adding !== null}
                      value={targetMode(g.key)}
                      onChange={(e) => {
                        const mode = e.target.value;
                        const text = mode === "own" ? "its own sales targets" : mode === "store" ? "the store target (measured on the store)" : "no sales target (store pool share only)";
                        if (confirm(`“${g.label}” will have ${text}. Continue?`)) run({ action: "group_targets", key: g.key, mode });
                        else e.target.value = targetMode(g.key);
                      }}
                    >
                      <option value="own">Own target</option>
                      <option value="store">Store target</option>
                      <option value="pool">No target — pool only</option>
                    </select>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">{count(g.key)}</td>
                <td className="px-2 py-2.5">
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    {renaming?.key === g.key ? (
                      <>
                        <button className={`${sbtn} bg-[#8883d7] text-white`} disabled={busy} onClick={() => run({ action: "group_rename", key: g.key, name: renaming.name })}>
                          Save
                        </button>
                        <button className={`${sbtn} ring-1 ring-black/10`} disabled={busy} onClick={() => setRenaming(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      !renaming &&
                      adding === null && (
                        <>
                          <button className={`${sbtn} ring-1 ring-black/10 hover:bg-black/5`} onClick={() => setRenaming({ key: g.key, name: g.label })}>
                            ✎ Edit
                          </button>
                          {g.custom && (
                            <button
                              className={`${sbtn} text-red-700 ring-1 ring-red-200 hover:bg-red-50`}
                              disabled={busy}
                              onClick={() => confirm(`Delete the group “${g.label}”?`) && run({ action: "group_delete", key: g.key })}
                            >
                              Delete
                            </button>
                          )}
                        </>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {adding !== null && (
              <tr className="border-t border-black/5 bg-[#8883d7]/[0.05]">
                <td className="px-2 py-2.5" colSpan={4}>
                  <input className={`${input} py-1`} maxLength={40} placeholder="New group name, e.g. Social Media" value={adding} onChange={(e) => setAdding(e.target.value)} autoFocus />
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    <button className={`${sbtn} bg-[#8883d7] text-white`} disabled={busy || !adding.trim()} onClick={() => run({ action: "group_add", name: adding })}>
                      Add
                    </button>
                    <button className={`${sbtn} ring-1 ring-black/10`} disabled={busy} onClick={() => setAdding(null)}>
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <label className="mt-4 flex items-start gap-2 rounded-2xl bg-black/[0.02] p-3 text-sm ring-1 ring-black/5">
        <input
          type="checkbox"
          className="mt-1"
          checked={settings.asmIsFm}
          disabled={busy}
          onChange={(e) =>
            confirm(
              e.target.checked
                ? "Treat Assistant Store Manager and Floor Manager as one role? Floor Managers move into the ASM group (unless a group was chosen for them) and get one action plan."
                : "Separate Assistant Store Manager and Floor Manager? Floor Managers go back to the Sales Team group (unless a group was chosen for them) and get their own action plan."
            ) && run({ action: "asm_is_fm", on: e.target.checked })
          }
        />
        <span>
          <b>Assistant Store Manager and Floor Manager are one role</b>
          <span className="block text-xs text-black/55">Untick when the roles are separated. You can then add a “Floor Manager” group with + Add group and give it its own share and targets.</span>
        </span>
      </label>
      <p className="mt-3 text-xs text-black/50">A new group gets incentives once you tick it in an incentive (✎ Change in the Incentives box). In the store pool it shares its part equally.</p>
    </Card>
  );
}

// ------------------------------------------------------------------
// Copy bills from Zoho
// ------------------------------------------------------------------

type Backfill = BackfillState & { pending: string[]; zohoToday: number };

function StockCard({ stock, isSuperAdmin, zohoToday, quota }: { stock: StockReadState | null; isSuperAdmin: boolean; zohoToday: number; quota: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  async function readNow() {
    if (!confirm(`Read stock from Zoho POS now? It uses about 1 request for every 200 items plus 1 for every 100 items in stock (${zohoToday.toLocaleString("en-IN")} of ${quota.toLocaleString("en-IN")} used today). It also runs every night at 11:30 pm.`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/staff/admin/stock-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read_stock" }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start.");
      setMsg("Reading stock in the background — refresh this page in a few minutes.");
      setTimeout(() => router.refresh(), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start.");
    } finally {
      setBusy(false);
    }
  }
  const at = stock?.lastAt ? new Date(stock.lastAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : null;
  return (
    <Card
      title="Stock from Zoho POS (every night)"
      intro="Stock per store is read every night at 11:30 pm, before the night copy, for sell-through, stock cover, stock-outs and the low-stock alerts."
      actions={
        isSuperAdmin ? (
          <button className={`${sbtn} ring-1 ring-black/10 hover:bg-black/5`} disabled={busy} onClick={readNow}>
            {busy ? "Starting…" : "↻ Read stock now"}
          </button>
        ) : undefined
      }
    >
      {error && <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {msg && <p className="mb-2 text-sm font-semibold text-green-700">{msg}</p>}
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
          <p className="text-xs font-bold uppercase tracking-wide text-black/45">Last read</p>
          <p className="mt-1 font-bold">{at ?? "Not read yet"}</p>
          <p className="text-xs text-black/55">{stock?.lastAt ? `${stock.items.toLocaleString("en-IN")} items · ${stock.reads} requests · ${stock.stores.join(", ")}` : "First read tonight at 11:30 pm."}</p>
        </div>
        <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5 sm:col-span-2">
          <p className="text-xs font-bold uppercase tracking-wide text-black/45">Alerts</p>
          {stock && Object.keys(stock.alerts).length ? (
            <ul className="mt-1 space-y-0.5">
              {Object.entries(stock.alerts).map(([s, a]) => (
                <li key={s}>
                  <a className="font-semibold text-[#5b55c9] underline" href={`/staff/performance/stock?store=${encodeURIComponent(s)}&show=low`}>
                    {s}
                  </a>
                  : {a.low} fast mover(s) low · {a.out} out of stock
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-black/55">Shown after the first stock read.</p>
          )}
          {stock?.note && <p className="mt-1 text-xs text-amber-800">Last attempt: {stock.note}</p>}
        </div>
      </div>
    </Card>
  );
}

function NightCopyCard({ backfill, thisMonth }: { backfill: Backfill; thisMonth: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [on, setOn] = useState(backfill.on);
  const [fromMonth, setFromMonth] = useState(backfill.fromMonth);
  const [quota, setQuota] = useState(String(backfill.dailyQuota));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(recheck = false) {
    setBusy(true);
    setError("");
    try {
      await post({ action: "backfill_settings", on, fromMonth, dailyQuota: quota, recheck });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  const n = backfill.lastNight;
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "");
  const lastMonth = shiftMonth(thisMonth, -1);
  return (
    <Card
      title="Earlier months from Zoho POS (every night)"
      intro={
        <>
          Every night between <b>11:30 and 11:59 pm</b> the app copies the bills and returns of earlier months, newest month first, 200
          records per list request. It keeps under 75 requests a minute (Zoho allows 100) and stops before the daily quota. This month is
          copied every 30 minutes as before.
        </>
      }
      actions={
        !editing ? (
          <button className={`${sbtn} ring-1 ring-black/10 hover:bg-black/5`} onClick={() => setEditing(true)}>
            ✎ Change
          </button>
        ) : undefined
      }
    >
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {editing ? (
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <label className="flex items-center gap-2 font-semibold sm:col-span-3">
            <input type="checkbox" className="h-4 w-4" checked={on} onChange={(e) => setOn(e.target.checked)} /> Copy earlier months at night
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-black/45">From month</span>
            <input type="month" className={`${input} mt-1`} value={fromMonth} max={lastMonth} onChange={(e) => setFromMonth(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-black/45">Zoho daily request quota</span>
            <input className={`${input} mt-1`} inputMode="numeric" value={quota} onChange={(e) => setQuota(e.target.value.replace(/[^\d]/g, ""))} />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <button className={primary} disabled={busy} onClick={() => save(false)}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className={`${sbtn} ring-1 ring-black/10`} disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          <p className="text-xs text-black/50 sm:col-span-3">
            <button className="font-semibold text-[#5b55c9] underline" disabled={busy} onClick={() => confirm("Check every month again from the first month? Bills already copied are skipped, so this costs only the list requests.") && save(true)}>
              Check all months again
            </button>{" "}
            — use this if bills were changed in Zoho after a month was copied.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
            <p className="text-xs font-bold uppercase tracking-wide text-black/45">Status</p>
            <p className={`mt-1 font-bold ${backfill.on ? "text-green-700" : "text-black/45"}`}>{backfill.on ? "On" : "Off"}</p>
            <p className="text-xs text-black/55">
              From {monthLabel(backfill.fromMonth)} · quota {backfill.dailyQuota.toLocaleString("en-IN")} a day · {backfill.zohoToday.toLocaleString("en-IN")} used today
            </p>
          </div>
          <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
            <p className="text-xs font-bold uppercase tracking-wide text-black/45">Months</p>
            <p className="mt-1 font-bold">
              {backfill.doneMonths.filter((m) => m >= backfill.fromMonth && m < thisMonth).length} copied · {backfill.pending.length} to go
            </p>
            <p className="text-xs text-black/55">
              {backfill.pending.length ? `Next: ${backfill.pending.slice(0, 3).map(monthLabel).join(", ")}${backfill.pending.length > 3 ? " …" : ""}` : "All earlier months are copied."}
              {backfill.progress ? ` · ${monthLabel(backfill.progress.month)}: ${backfill.progress.billsSaved}/${backfill.progress.bills} bills` : ""}
            </p>
          </div>
          <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
            <p className="text-xs font-bold uppercase tracking-wide text-black/45">Last night</p>
            {n ? (
              <>
                <p className="mt-1 font-bold">
                  {n.bills} bills · {n.returns} returns
                </p>
                <p className="text-xs text-black/55">
                  {fmtDate(n.day)} {time(n.startedAt)}–{n.endedAt ? time(n.endedAt) : "running"} · {n.reads} requests
                  {n.note ? ` · ${n.note}` : ""}
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-black/55">Not run yet — the first copy starts tonight at 11:30 pm.</p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function SyncCard({ month, today, settings, billsCopied, lastBillDate }: { month: string; today: string; settings: PerformanceSettings; billsCopied: number; lastBillDate: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string>("");
  const [error, setError] = useState("");
  const [returnsError, setReturnsError] = useState(settings.returnsError ?? "");

  async function run() {
    setBusy(true);
    setError("");
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let bills = 0;
    let returns = 0;
    let rErr = "";
    try {
      for (let d = 1; d <= last; d++) {
        const date = `${month}-${String(d).padStart(2, "0")}`;
        if (date > today) break;
        for (let round = 0; round < 40; round++) {
          setLog(`Copying ${fmtDate(date)}… (${bills} bills, ${returns} returns so far)`);
          let r: { billsSaved?: number; returnsSaved?: number; returnsError?: string; pending?: number } = {};
          for (let attempt = 1; ; attempt++) {
            try {
              r = await post({ action: "sync", date });
              break;
            } catch (e) {
              if (attempt >= 4) throw e;
              setLog(`Zoho is busy — waiting a minute, then going on with ${fmtDate(date)}…`);
              await new Promise((z) => setTimeout(z, 60_000));
            }
          }
          bills += r.billsSaved ?? 0;
          returns += r.returnsSaved ?? 0;
          if (r.returnsError) rErr = r.returnsError;
          if (!r.pending) break;
          // stay well inside Zoho's per-minute limit
          await new Promise((z) => setTimeout(z, 30_000));
        }
      }
      setReturnsError(rErr);
      setLog(`Done — ${bills} bill(s) and ${returns} return(s) copied or updated for ${monthLabel(month)}.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Copy failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Bills from Zoho POS"
      intro={
        <>
          New bills and returns are copied automatically every 30 minutes. {billsCopied.toLocaleString("en-IN")} bill(s) copied for {monthLabel(month)}
          {lastBillDate ? `, latest ${fmtDate(lastBillDate)}` : ""}.
        </>
      }
      actions={
        <button className={primary} disabled={busy} onClick={run}>
          {busy ? "Copying…" : `Copy all of ${monthLabel(month).split(" ")[0]}`}
        </button>
      }
    >
      {log && <p className="text-sm text-black/70">{log}</p>}
      {busy && <p className="mt-1 text-xs text-black/45">Keep this page open. A full month takes a few minutes because Zoho allows only a limited number of reads per minute.</p>}
      {error && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {returnsError && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ⚠️ Returns (credit notes) could not be read: {returnsError}. Open{" "}
          <a href="/staff/admin/zoho" className="font-semibold underline">
            Zoho POS
          </a>{" "}
          and press <b>Connect</b> again so the app may also read credit notes. Until then, net sales do not subtract returns.
        </p>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------
// Targets
// ------------------------------------------------------------------

function TargetsCard(props: {
  month: string;
  thisMonth: string;
  settings: PerformanceSettings;
  stores: string[];
  people: Person[];
  targets: Record<string, { sales: number; abv: number | null }>;
  storeMonthTargets: Record<string, number>;
  salaries: Record<string, number>;
}) {
  const router = useRouter();
  const { month, settings } = props;
  const groups = groupList(settings);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  type RowState = { sales: string; abv: string; group: IncentiveGroup; store: string; salary: string; shift: string };
  const startRows = () =>
    Object.fromEntries(
      props.people.map((p) => [
        p.userId,
        {
          sales: props.targets[p.userId]?.sales ? String(props.targets[p.userId].sales) : "",
          abv: props.targets[p.userId]?.abv ? String(props.targets[p.userId].abv) : "",
          group: p.group,
          store: p.chosenStore ?? "",
          salary: props.salaries[p.userId] ? String(props.salaries[p.userId]) : "",
          shift: settings.personShifts[p.userId] ?? "",
        },
      ])
    );
  const [rows, setRows] = useState<Record<string, RowState>>(startRows);
  const startStores = () => Object.fromEntries(props.stores.map((s) => [s, props.storeMonthTargets[s] ? String(props.storeMonthTargets[s]) : ""]));
  const [storeRows, setStoreRows] = useState<Record<string, string>>(startStores);
  const setRow = (id: string, change: Partial<RowState>) => setRows({ ...rows, [id]: { ...rows[id], ...change } });

  const noOwnTarget = (g: string) => settings.noTargetGroups.includes(g) || settings.poolOnlyGroups.includes(g);
  const groupOf = (p: Person) => (editing ? rows[p.userId]?.group ?? p.group : p.group);
  const isCorporate = (p: Person) => !p.homeStore || !props.stores.includes(p.homeStore);
  const storeFor = (p: Person) => (editing ? (isCorporate(p) ? rows[p.userId]?.store || p.store : p.homeStore) : p.store);

  const { byStore, notIn } = useMemo(() => {
    const out = new Map<string, Person[]>();
    const none: Person[] = [];
    for (const p of props.people) {
      if (groupOf(p) === "none") {
        none.push(p);
        continue;
      }
      const s = storeFor(p) && props.stores.includes(storeFor(p) as string) ? (storeFor(p) as string) : "Choose a store";
      if (!out.has(s)) out.set(s, []);
      out.get(s)!.push(p);
    }
    const excluded = settings.excludedStores.map((s) => s.toUpperCase());
    return {
      byStore: [...out.entries()]
        .filter(([s]) => !excluded.includes(s))
        .sort(([a], [b]) => (a === "Choose a store" ? 1 : b === "Choose a store" ? -1 : a.localeCompare(b))),
      notIn: none,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.people, settings.excludedStores, editing, rows]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      // People not in incentive have no targets.
      await post({
        action: "targets",
        month,
        // People not in incentive, and groups without individual targets (Store Manager), have no targets.
        rows: Object.entries(rows).map(([userId, r]) =>
          r.group === "none" || noOwnTarget(r.group) ? { userId, sales: "", abv: "" } : { userId, sales: r.sales, abv: r.abv }
        ),
      });
      const salaryRows = props.people
        .filter((p) => (rows[p.userId]?.salary ?? "") !== (props.salaries[p.userId] ? String(props.salaries[p.userId]) : ""))
        .map((p) => ({ userId: p.userId, salary: rows[p.userId]?.salary ?? "" }));
      if (salaryRows.length) await post({ action: "salaries", rows: salaryRows });
      for (const p of props.people) {
        const r = rows[p.userId];
        if (!r) continue;
        if (r.group !== p.group) await post({ action: "group", staffId: p.id, group: r.group });
        if (isCorporate(p) && (r.store || "") !== (p.chosenStore ?? "")) await post({ action: "incentive_store", userId: p.userId, store: r.store });
        if ((r.shift || "") !== (settings.personShifts[p.userId] ?? "")) await post({ action: "person_shift", userId: p.userId, shift: r.shift });
      }
      for (const s of props.stores) {
        const was = props.storeMonthTargets[s] ? String(props.storeMonthTargets[s]) : "";
        if ((storeRows[s] ?? "") !== was) await post({ action: "store_target", month, store: s, target: storeRows[s] ?? "" });
      }
      setEditing(false);
      setMsg("Saved.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLastMonth() {
    if (!confirm(`Copy the targets of ${monthLabel(shiftMonth(month, -1))} to ${monthLabel(month)}? People who already have a target this month keep theirs.`)) return;
    setBusy(true);
    setError("");
    try {
      const r = await post({ action: "copy_targets", from: shiftMonth(month, -1), to: month });
      setMsg(`${r.copied} target(s) copied.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not copy.");
    } finally {
      setBusy(false);
    }
  }

  const storeTarget = (s: string) => props.storeMonthTargets[s] || settings.storeTargets[s] || 0;
  const groupSelect = (p: Person) => (
    <select className={`${input} py-1`} value={rows[p.userId]?.group ?? p.group} onChange={(e) => setRow(p.userId, { group: e.target.value })}>
      {groups.map((g) => (
        <option key={g.key} value={g.key}>
          {g.label}
        </option>
      ))}
    </select>
  );

  return (
    <Card
      title={`Targets — ${monthLabel(month)}`}
      intro="Individual targets are net sales with GST, after discounts and returns. The Store Manager is measured on the store target; groups set to “No target — pool only” (e.g. data entry) only share the store pool. The group decides which part of the store pool a person shares."
      actions={
        <>
          <a href={`/staff/admin/performance?m=${shiftMonth(month, -1)}`} className={ghost}>
            ← {monthLabel(shiftMonth(month, -1)).split(" ")[0]}
          </a>
          {month < shiftMonth(props.thisMonth, 2) && (
            <a href={`/staff/admin/performance?m=${shiftMonth(month, 1)}`} className={ghost}>
              {monthLabel(shiftMonth(month, 1)).split(" ")[0]} →
            </a>
          )}
          {!editing && (
            <button className={ghost} disabled={busy} onClick={copyLastMonth}>
              Copy from {monthLabel(shiftMonth(month, -1)).split(" ")[0]}
            </button>
          )}
          {!editing ? (
            <button
              className={primary}
              onClick={() => {
                setRows(startRows());
                setStoreRows(startStores());
                setEditing(true);
                setMsg("");
              }}
            >
              ✎ Edit targets
            </button>
          ) : (
            <>
              <button className={primary} disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button className={ghost} disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          )}
        </>
      }
    >
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {msg && !editing && <p className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800">{msg}</p>}
      <div className="space-y-6">
        {byStore.map(([store, list]) => (
          <div key={store}>
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <h3 className={`text-base font-bold ${store === "Choose a store" ? "text-amber-700" : ""}`}>{store}</h3>
              {store === "Choose a store" && <span className="text-sm text-black/55">Corporate Office staff in an incentive group: choose the store whose pool they share.</span>}
              {props.stores.includes(store) && (
                <span className="text-sm text-black/60">
                  Store target:{" "}
                  {editing ? (
                    <input
                      className={`${input} inline-block w-36 py-1`}
                      inputMode="numeric"
                      placeholder={settings.storeTargets[store] ? String(settings.storeTargets[store]) : "Default"}
                      value={storeRows[store] ?? ""}
                      onChange={(e) => setStoreRows({ ...storeRows, [store]: e.target.value.replace(/[^\d]/g, "") })}
                    />
                  ) : (
                    <b className="text-black">{storeTarget(store) ? rupees(storeTarget(store)) : "not set"}</b>
                  )}
                  {!editing && props.storeMonthTargets[store] ? <span className="ml-1 text-xs">(this month only)</span> : null}
                </span>
              )}
            </div>
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[740px] table-fixed text-sm">
                <colgroup>
                  <col />
                  <col className="w-56" />
                  <col className="w-40" />
                  <col className="w-36" />
                  <col className="w-36" />
                </colgroup>
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-black/45">
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Group</th>
                    <th className="px-2 py-2 text-right">Sales target</th>
                    <th className="px-2 py-2 text-right">ABV target</th>
                    <th className="px-2 py-2 text-right" title="Only management sees salaries">Salary / month</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const r = rows[p.userId];
                    const t = props.targets[p.userId];
                    return (
                      <tr key={p.id} className="border-t border-black/5 align-top">
                        <td className="px-2 py-2">
                          <span className="font-semibold">{p.name}</span> <span className="text-xs text-black/40">{p.userId}</span>
                          {isCorporate(p) &&
                            (editing ? (
                              <select className={`${input} mt-1 w-48 py-1 text-xs`} value={r?.store ?? ""} onChange={(e) => setRow(p.userId, { store: e.target.value })}>
                                <option value="">{p.store && props.stores.includes(p.store) ? `Where they sell most (${p.store})` : "Where they sell most"}</option>
                                {props.stores.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="ml-1.5 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold text-black/50">{p.homeStore ?? "No store"}</span>
                            ))}
                        </td>
                        <td className="px-2 py-2">
                          {editing ? groupSelect(p) : <span>{groupName(p.group, settings.groupLabels)}</span>}
                          {settings.shifts.length > 1 &&
                            (editing ? (
                              <select className={`${input} mt-1 py-1 text-xs`} value={r?.shift || settings.shifts[0].name} onChange={(e) => setRow(p.userId, { shift: e.target.value === settings.shifts[0].name ? "" : e.target.value })}>
                                {settings.shifts.map((sh) => (
                                  <option key={sh.name} value={sh.name}>
                                    {sh.name} ({sh.start})
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="mt-0.5 block text-[11px] text-black/45">Shift: {settings.personShifts[p.userId] && settings.shifts.some((x) => x.name === settings.personShifts[p.userId]) ? settings.personShifts[p.userId] : settings.shifts[0].name}</span>
                            ))}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {noOwnTarget(groupOf(p)) ? (
                            <span className="text-xs text-black/45">{settings.noTargetGroups.includes(groupOf(p)) ? "Store target" : "No target — pool only"}</span>
                          ) : editing ? (
                            <input className={`${input} py-1 text-right`} inputMode="numeric" placeholder="—" value={r?.sales ?? ""} onChange={(e) => setRow(p.userId, { sales: e.target.value.replace(/[^\d]/g, "") })} />
                          ) : t?.sales ? (
                            <b>{rupees(t.sales)}</b>
                          ) : (
                            <span className="text-black/30">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {noOwnTarget(groupOf(p)) ? (
                            <span className="text-xs text-black/30">—</span>
                          ) : editing ? (
                            <input className={`${input} py-1 text-right`} inputMode="numeric" placeholder="—" value={r?.abv ?? ""} onChange={(e) => setRow(p.userId, { abv: e.target.value.replace(/[^\d]/g, "") })} />
                          ) : t?.abv ? (
                            rupees(t.abv)
                          ) : (
                            <span className="text-black/30">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {editing ? (
                            <input className={`${input} py-1 text-right`} inputMode="numeric" placeholder="—" value={r?.salary ?? ""} onChange={(e) => setRow(p.userId, { salary: e.target.value.replace(/[^\d]/g, "") })} />
                          ) : props.salaries[p.userId] ? (
                            <span className="text-black/60">{rupees(props.salaries[p.userId])}</span>
                          ) : (
                            <span className="text-black/30">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {editing && notIn.length > 0 && (
          <div>
            <h3 className="mb-2 text-base font-bold">{groupName("none", settings.groupLabels)}</h3>
            <ul className="divide-y divide-black/5 rounded-2xl ring-1 ring-black/5">
              {notIn.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold">{p.name}</span> <span className="text-xs text-black/40">{p.userId}</span>
                    <span className="ml-1.5 text-xs text-black/45">{p.homeStore ?? ""}</span>
                  </span>
                  {editing && <span className="w-56">{groupSelect(p)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Slow-moving and Buy 2 Get 1 products
// ------------------------------------------------------------------

function PromoCard({ promos, rules, today }: { promos: Promo[]; rules: IncentiveRule[]; today: string }) {
  const router = useRouter();
  // One product list per product incentive (versions of the same incentive share their list).
  const tabs: { list: string; name: string; summary: string }[] = [];
  for (const r of [...rules].reverse()) {
    if (r.kind !== "product_units" && r.kind !== "product_value") continue;
    if (ruleStatus(r, today) === "ended" && rules.some((x) => x !== r && "list" in x && x.list === r.list && ruleStatus(x, today) !== "ended")) continue;
    if (tabs.some((t) => t.list === r.list)) continue;
    tabs.push({ list: r.list, name: r.name + (ruleStatus(r, today) === "ended" ? " (stopped)" : ""), summary: ruleSummary(r) });
  }
  tabs.reverse();
  const [tab, setTab] = useState<string>(tabs[0]?.list ?? "");
  const current = tabs.find((t) => t.list === tab) ?? tabs[0];
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ZItem[] | null>(null);
  const [picked, setPicked] = useState<Record<string, ZItem>>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = promos.filter((p) => p.kind === current?.list);

  async function search() {
    if (q.trim().length < 2) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/staff/admin/performance?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed.");
      setResults(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    setBusy(true);
    setError("");
    try {
      await post({ action: "promo_add", kind: current?.list, items: Object.values(picked), from: from || null, to: to || null });
      setPicked({});
      setResults(null);
      setQ("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Promo) {
    if (!confirm(`Remove “${p.name}” from the ${current?.name ?? ""} list?`)) return;
    setBusy(true);
    try {
      await post({ action: "promo_remove", id: p.id });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Products for incentives"
      intro={current ? `${current.name}: ${current.summary}` : "Add an incentive of the kind “Per item of listed products” or “Value of listed products” first."}
    >
      <div className="mb-4 flex flex-wrap gap-1 rounded-2xl bg-black/[0.04] p-1">
        {tabs.map((t) => (
          <button
            key={t.list}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${current?.list === t.list ? "bg-white shadow ring-1 ring-black/5" : "text-black/55"}`}
            onClick={() => {
              setTab(t.list);
              setPicked({});
            }}
          >
            {t.name} ({promos.filter((p) => p.kind === t.list).length})
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
        <p className="text-sm font-semibold">Add products from Zoho POS</p>
        <div className="mt-2 flex gap-2">
          <input className={input} placeholder="Search by product name or SKU" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <button className={ghost} disabled={busy || q.trim().length < 2} onClick={search}>
            Search
          </button>
        </div>
        {results && (
          <div className="mt-3 max-h-72 overflow-y-auto rounded-xl bg-white ring-1 ring-black/5">
            {results.length === 0 && <p className="p-3 text-sm text-black/50">Nothing found.</p>}
            {results.map((i) => {
              const on = Boolean(picked[i.item_id]);
              const already = promos.some((p) => p.kind === current?.list && p.item_id === i.item_id);
              return (
                <label key={i.item_id} className={`flex cursor-pointer items-center gap-3 border-b border-black/5 px-3 py-2 text-sm last:border-0 ${already ? "opacity-50" : ""}`}>
                  <input
                    type="checkbox"
                    disabled={already}
                    checked={on || already}
                    onChange={() => {
                      const next = { ...picked };
                      if (on) delete next[i.item_id];
                      else next[i.item_id] = i;
                      setPicked(next);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{i.name}</span>
                    <span className="ml-2 text-xs text-black/45">
                      {i.sku ?? ""} {i.category ? `· ${i.category}` : ""} · {rupees(i.rate)}
                    </span>
                  </span>
                  {already && <span className="text-xs">on the list</span>}
                </label>
              );
            })}
          </div>
        )}
        {Object.keys(picked).length > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold text-black/55">
              From (optional)
              <input type="date" className={`${input} mt-1`} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-xs font-semibold text-black/55">
              Until (optional)
              <input type="date" className={`${input} mt-1`} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button className={primary} disabled={busy} onClick={add}>
              Add {Object.keys(picked).length} product(s)
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="mt-4">
        {list.length === 0 ? (
          <p className="text-sm text-black/50">No products on this list yet.</p>
        ) : (
          <ul className="divide-y divide-black/5">
            {list.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-black/45">
                    {p.sku ?? ""}
                    {p.from_date || p.to_date ? ` · ${p.from_date ? fmtDate(p.from_date) : "…"} – ${p.to_date ? fmtDate(p.to_date) : "no end"}` : " · always"}
                  </span>
                </span>
                <button className="rounded-full px-3 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50" disabled={busy} onClick={() => remove(p)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Settings
// ------------------------------------------------------------------

function SettingsCard({ settings, stores }: { settings: PerformanceSettings; stores: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pct, setPct] = useState(String(settings.highDiscountPct));
  const [duties, setDuties] = useState(String(settings.dutiesRequired));
  const [sps, setSps] = useState(settings.salesPerSalary ? String(settings.salesPerSalary) : "");
  const [shifts, setShifts] = useState(settings.shifts);
  const [grace, setGrace] = useState(String(settings.lateGraceMinutes));
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<string[]>(settings.excludedStores);
  const allStores = [...new Set([...stores, ...Object.keys(settings.storeTargets), ...settings.excludedStores])].sort();

  function start() {
    setPct(String(settings.highDiscountPct));
    setDuties(String(settings.dutiesRequired));
    setSps(settings.salesPerSalary ? String(settings.salesPerSalary) : "");
    setShifts(settings.shifts);
    setGrace(String(settings.lateGraceMinutes));
    setTargets(Object.fromEntries(allStores.map((s) => [s, settings.storeTargets[s] ? String(settings.storeTargets[s]) : ""])));
    setExcluded(settings.excludedStores);
    setEditing(true);
    setError("");
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const storeTargets = Object.fromEntries(Object.entries(targets).filter(([, v]) => v !== ""));
      await post({ action: "settings", highDiscountPct: pct, dutiesRequired: duties, storeTargets, excludedStores: excluded, salesPerSalary: sps, shifts, lateGraceMinutes: grace });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Rules"
      intro="Discount limit, attendance rule and the normal monthly target of each store."
      actions={
        !editing ? (
          <button className={primary} onClick={start}>
            ✎ Edit
          </button>
        ) : (
          <>
            <button className={primary} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className={ghost} disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        )
      }
    >
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
          <p className="text-xs font-bold uppercase tracking-wide text-black/45">High discount</p>
          {editing ? (
            <label className="mt-2 flex items-center gap-2 text-sm">
              More than <input className={`${input} w-20`} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))} /> % of a bill
            </label>
          ) : (
            <p className="mt-1 text-sm">
              A bill is flagged when its discount is more than <b>{settings.highDiscountPct}%</b> of the bill.
            </p>
          )}
        </div>
        <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
          <p className="text-xs font-bold uppercase tracking-wide text-black/45">Attendance</p>
          {editing ? (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input className={`${input} w-20`} inputMode="numeric" value={duties} onChange={(e) => setDuties(e.target.value.replace(/[^\d]/g, ""))} /> duties needed in a month
            </label>
          ) : (
            <p className="mt-1 text-sm">
              <b>{settings.dutiesRequired}</b> duties a month. Each duty short is one unauthorised absence: 1 → 75% paid, 2 → 50%, 3 or more → nothing.
            </p>
          )}
        </div>
        <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5 sm:col-span-2">
          <p className="text-xs font-bold uppercase tracking-wide text-black/45">Shifts and late coming</p>
          {editing ? (
            <div className="mt-2 space-y-2 text-sm">
              {shifts.map((sh, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input className={`${input} w-40`} placeholder="Shift name" value={sh.name} maxLength={30} onChange={(e) => setShifts(shifts.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                  starts at
                  <input type="time" className={`${input} w-32`} value={sh.start} onChange={(e) => setShifts(shifts.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)))} />
                  {i === 0 && <span className="text-xs text-black/45">(everyone, unless another shift is chosen)</span>}
                  {i > 0 && (
                    <button className="text-xs text-red-700" onClick={() => setShifts(shifts.filter((_, k) => k !== i))}>
                      remove
                    </button>
                  )}
                </div>
              ))}
              <button className="text-sm font-semibold text-[#5b55c9]" onClick={() => setShifts([...shifts, { name: `Shift ${shifts.length + 1}`, start: "12:30" }])}>
                + Add shift
              </button>
              <label className="flex items-center gap-2">
                Late after <input className={`${input} w-20`} inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value.replace(/[^\d]/g, ""))} /> minutes past the start
              </label>
            </div>
          ) : (
            <p className="mt-1 text-sm">
              {settings.shifts.map((sh) => `${sh.name} ${sh.start}`).join(" · ")} — late when the first punch is more than <b>{settings.lateGraceMinutes} min</b> after the shift start.
              {settings.shifts.length > 1 ? " Choose each person's shift under Edit targets." : ""}
            </p>
          )}
        </div>
        <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5 sm:col-span-2">
          <p className="text-xs font-bold uppercase tracking-wide text-black/45">Staff worth (management only)</p>
          {editing ? (
            <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              Flag people who sell less than ₹ <input className={`${input} w-20`} inputMode="decimal" value={sps} onChange={(e) => setSps(e.target.value.replace(/[^\d.]/g, ""))} /> for every ₹1 of salary (empty = only compare with the store)
            </label>
          ) : (
            <p className="mt-1 text-sm">
              {settings.salesPerSalary ? (
                <>
                  People selling less than <b>₹{settings.salesPerSalary}</b> for every ₹1 of salary are flagged for review.
                </>
              ) : (
                "People are compared with the store average (no minimum set)."
              )}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-black/45">Monthly store targets</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {allStores.map((s) => {
            const off = (editing ? excluded : settings.excludedStores).includes(s);
            return (
              <div key={s} className={`rounded-2xl p-3 ring-1 ring-black/5 ${off ? "bg-black/[0.03] text-black/45" : "bg-white"}`}>
                <p className="text-sm font-bold">{s}</p>
                {editing ? (
                  <div className="mt-1 space-y-1.5">
                    <input className={input} inputMode="numeric" placeholder="Monthly target ₹" disabled={off} value={targets[s] ?? ""} onChange={(e) => setTargets({ ...targets, [s]: e.target.value.replace(/[^\d]/g, "") })} />
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={off} onChange={() => setExcluded(off ? excluded.filter((x) => x !== s) : [...excluded, s])} />
                      Leave out (not opened yet)
                    </label>
                  </div>
                ) : (
                  <p className="text-sm">{off ? "Left out" : settings.storeTargets[s] ? rupees(settings.storeTargets[s]) : "No target"}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Salesperson names without a User ID
// ------------------------------------------------------------------

function LinksCard({ unlinked, people }: { unlinked: { name: string; net: number; bills: number }[]; people: Person[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<Record<string, string>>({});
  async function link(name: string) {
    setBusy(name);
    setError("");
    try {
      await post({ action: "link", salesperson: name, userId: choice[name] ?? "" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link.");
    } finally {
      setBusy("");
    }
  }
  return (
    <Card title="Salesperson names to link" intro="These salesperson names on Zoho bills have no User ID, or a User ID that no staff member has. Link each to the right person so their sales count for them.">
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <ul className="divide-y divide-black/5">
        {unlinked.map((u) => (
          <li key={u.name} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
            <span className="min-w-40 flex-1">
              <b>{u.name}</b> <span className="text-xs text-black/45">· {u.bills} bills · {rupees(u.net)}</span>
            </span>
            <select className={`${input} w-64`} value={choice[u.name] ?? ""} onChange={(e) => setChoice({ ...choice, [u.name]: e.target.value })}>
              <option value="">Choose staff…</option>
              {people.map((p) => (
                <option key={p.id} value={p.userId}>
                  {p.name} ({p.userId}) {p.store ? `· ${p.store}` : ""}
                </option>
              ))}
            </select>
            <button className={primary} disabled={!choice[u.name] || busy === u.name} onClick={() => link(u.name)}>
              {busy === u.name ? "Linking…" : "Link"}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
