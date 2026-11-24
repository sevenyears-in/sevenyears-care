"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ALERT_AUDIENCES, groupList, groupName, rupees, type AlertAudience, type IncentiveGroup, type PerformanceSettings } from "@/lib/performance-rules";
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
  /** Temporary (daily-wages, PT code) staff: their store is chosen here, not with a Transfer. */
  isPt: boolean;
  /** Temporary staff: where they sold most this month (when no store is chosen). */
  soldMost: string | null;
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
  unlinked: Unlinked[];
  billsCopied: number;
  lastBillDate: string | null;
  rules: IncentiveRule[];
  backfill: Backfill;
  stock: StockReadState | null;
  isSuperAdmin: boolean;
  audit: AuditView[];
  alertRuns: AlertRunView[];
  pushReady: boolean;
  emailReady: boolean;
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
      <BusinessDayCard settings={props.settings} stores={props.stores} />
      <AlertsCard settings={props.settings} runs={props.alertRuns} isSuperAdmin={props.isSuperAdmin} pushReady={props.pushReady} emailReady={props.emailReady} />
      <AuditCard rows={props.audit} />
    </div>
  );
}

// ------------------------------------------------------------------
// Group names
// ------------------------------------------------------------------

function GroupNamesCard({ settings, people }: { settings: PerformanceSettings; people: Person[] }) {
  const router = useRouter();
  const groups = groupList(settings);
  const modeOf = (key: string) => (settings.noTargetGroups.includes(key) ? "store" : settings.poolOnlyGroups.includes(key) ? "pool" : "own");
  const MODE_LABEL: Record<string, string> = { own: "Own target", store: "Store target", pool: "No target — pool only" };
  // View → Edit → change → Save or Cancel. Nothing changes until Save.
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, string>>({});
  const [asm, setAsm] = useState(settings.asmIsFm);
  const [adding, setAdding] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const count = (key: string) => people.filter((p) => p.group === key).length;

  function start() {
    setNames(Object.fromEntries(groups.map((g) => [g.key, g.label])));
    setModes(Object.fromEntries(groups.map((g) => [g.key, modeOf(g.key)])));
    setAsm(settings.asmIsFm);
    setAdding([]);
    setRemoving([]);
    setError("");
    setEditing(true);
  }

  const changes = () => {
    const list: { body: Record<string, unknown>; text: string }[] = [];
    for (const g of groups) {
      if (removing.includes(g.key)) {
        list.push({ body: { action: "group_delete", key: g.key }, text: `Delete “${g.label}”` });
        continue;
      }
      const name = (names[g.key] ?? g.label).trim();
      if (name && name !== g.label) list.push({ body: { action: "group_rename", key: g.key, name }, text: `Rename “${g.label}” to “${name}”` });
      if (g.key !== "none" && modes[g.key] && modes[g.key] !== modeOf(g.key)) list.push({ body: { action: "group_targets", key: g.key, mode: modes[g.key] }, text: `“${name || g.label}”: ${MODE_LABEL[modes[g.key]]}` });
    }
    for (const n of adding.map((x) => x.trim()).filter(Boolean)) list.push({ body: { action: "group_add", name: n }, text: `Add group “${n}”` });
    if (asm !== settings.asmIsFm) list.push({ body: { action: "asm_is_fm", on: asm }, text: asm ? "ASM and Floor Manager become one role" : "ASM and Floor Manager become separate roles" });
    return list;
  };

  async function save() {
    const list = changes();
    if (!list.length) return setEditing(false);
    if (!confirm(`Save these changes?\n\n• ${list.map((c) => c.text).join("\n• ")}`)) return;
    setBusy(true);
    setError("");
    try {
      for (const c of list) await post(c.body);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Groups"
      intro="The groups decide who shares which part of the store pool and who can earn each incentive."
      actions={
        editing ? (
          <div className="flex gap-2">
            <button className={primary} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className={`${sbtn} ring-1 ring-black/10`} disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className={`${sbtn} ring-1 ring-black/10 hover:bg-black/5`} onClick={start}>
            ✎ Edit
          </button>
        )
      }
    >
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed text-sm">
          <colgroup>
            <col />
            <col className="w-28" />
            <col className="w-52" />
            <col className="w-24" />
            {editing && <col className="w-24" />}
          </colgroup>
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-black/45">
              <th className="px-2 py-2">Group</th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2">Sales target</th>
              <th className="px-2 py-2 text-right">People</th>
              {editing && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const gone = removing.includes(g.key);
              return (
                <tr key={g.key} className={`border-t border-black/5 ${gone ? "opacity-40 line-through" : ""}`}>
                  <td className="px-2 py-2.5">
                    {editing && !gone ? (
                      <input className={`${input} py-1`} maxLength={40} value={names[g.key] ?? g.label} onChange={(e) => setNames({ ...names, [g.key]: e.target.value })} />
                    ) : (
                      <span className={`font-semibold ${g.key === "none" ? "text-black/50" : ""}`}>{g.label}</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-xs text-black/50">{g.custom ? "Added" : "Standard"}</td>
                  <td className="px-2 py-2.5">
                    {g.key === "none" ? (
                      <span className="text-xs text-black/35">—</span>
                    ) : editing && !gone ? (
                      <select className={`${input} py-1 text-xs`} value={modes[g.key] ?? modeOf(g.key)} onChange={(e) => setModes({ ...modes, [g.key]: e.target.value })}>
                        <option value="own">{MODE_LABEL.own}</option>
                        <option value="store">{MODE_LABEL.store}</option>
                        <option value="pool">{MODE_LABEL.pool}</option>
                      </select>
                    ) : (
                      <span className="text-xs">{MODE_LABEL[modeOf(g.key)]}</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{count(g.key)}</td>
                  {editing && (
                    <td className="px-2 py-2.5 text-right">
                      {g.custom &&
                        (gone ? (
                          <button className="text-xs font-semibold text-[#5b55c9]" onClick={() => setRemoving(removing.filter((k) => k !== g.key))}>
                            Undo
                          </button>
                        ) : (
                          <button className="text-xs font-semibold text-red-700" onClick={() => setRemoving([...removing, g.key])}>
                            Delete
                          </button>
                        ))}
                    </td>
                  )}
                </tr>
              );
            })}
            {editing &&
              adding.map((n, i) => (
                <tr key={`new-${i}`} className="border-t border-black/5 bg-[#8883d7]/[0.05]">
                  <td className="px-2 py-2.5" colSpan={4}>
                    <input className={`${input} py-1`} maxLength={40} placeholder="New group name, e.g. Social Media" value={n} onChange={(e) => setAdding(adding.map((x, k) => (k === i ? e.target.value : x)))} autoFocus />
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <button className="text-xs font-semibold text-red-700" onClick={() => setAdding(adding.filter((_, k) => k !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <button className="mt-2 text-sm font-semibold text-[#5b55c9]" onClick={() => setAdding([...adding, ""])}>
          + Add group
        </button>
      )}
      <div className="mt-4 flex items-start gap-2 rounded-2xl bg-black/[0.02] p-3 text-sm ring-1 ring-black/5">
        {editing ? (
          <input type="checkbox" className="mt-1" checked={asm} onChange={(e) => setAsm(e.target.checked)} />
        ) : (
          <span className="mt-0.5">{settings.asmIsFm ? "✓" : "✗"}</span>
        )}
        <span>
          <b>Assistant Store Manager and Floor Manager are one role</b>
          <span className="block text-xs text-black/55">Untick when the roles are separated. You can then add a “Floor Manager” group and give it its own share and targets.</span>
        </span>
      </div>
      <p className="mt-3 text-xs text-black/50">Every change is saved in the change history (bottom of this page). A new group gets incentives once you tick it in an incentive.</p>
    </Card>
  );
}

// ------------------------------------------------------------------
// Copy bills from Zoho
// ------------------------------------------------------------------

type Backfill = BackfillState & { pending: string[]; zohoToday: number };

export type AuditView = { id: number; at: string; user_name: string | null; area: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

const AREA_LABEL: Record<string, string> = { sales_settings: "Settings", incentive_rules: "Incentives", sales_tables: "Targets / products / links" };
const show = (v: unknown) => {
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t && t.length > 160 ? `${t.slice(0, 160)}…` : t ?? "—";
};

function AuditCard({ rows }: { rows: AuditView[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card
      title="Change history"
      intro="Every change to targets, incentives, groups and settings: who, when, the value before and after."
      actions={
        <button className={`${sbtn} ring-1 ring-black/10 hover:bg-black/5`} onClick={() => setOpen(!open)}>
          {open ? "Hide" : `Show (${rows.length})`}
        </button>
      }
    >
      {open && (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-black/45">
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">Who</th>
                <th className="px-2 py-2">What</th>
                <th className="px-2 py-2">Before</th>
                <th className="px-2 py-2">After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-black/5 align-top">
                  <td className="whitespace-nowrap px-2 py-2 text-xs">{new Date(r.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}</td>
                  <td className="px-2 py-2 text-xs">{r.user_name ?? "—"}</td>
                  <td className="px-2 py-2 text-xs">
                    {AREA_LABEL[r.area] ?? r.area} · {r.action}
                  </td>
                  <td className="max-w-[260px] break-words px-2 py-2 font-mono text-[11px] text-black/60">
                    {r.before ? Object.entries(r.before).map(([k, v]) => <div key={k}>{k}: {show(v)}</div>) : "—"}
                  </td>
                  <td className="max-w-[260px] break-words px-2 py-2 font-mono text-[11px]">
                    {r.after ? Object.entries(r.after).filter(([k]) => k !== "action").map(([k, v]) => <div key={k}>{k}: {show(v)}</div>) : "—"}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-sm text-black/50">
                    No changes recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function BusinessDayCard({ settings, stores }: { settings: PerformanceSettings; stores: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hours, setHours] = useState<Record<string, { open: string; close: string }>>({});
  const [special, setSpecial] = useState("");
  const [lean, setLean] = useState("");
  const [shortDay, setShortDay] = useState("");
  const [alerts, setAlerts] = useState("");
  const [velocity, setVelocity] = useState("");
  const [reorderTo, setReorderTo] = useState("");
  const all = ["*", ...stores];
  function start() {
    setHours(Object.fromEntries(all.map((s) => [s, settings.storeHours[s] ?? (s === "*" ? { open: "09:30", close: "22:00" } : { open: "", close: "" })])));
    setSpecial(settings.specialDays.join(", "));
    setLean(String(Math.round(settings.leanBelowPct * 100)));
    setShortDay(String(Math.round(settings.shortDayPct * 100)));
    setAlerts(settings.alertTimes.join(", "));
    setVelocity(String(settings.velocityDays));
    setReorderTo(String(settings.reorderToDays));
    setError("");
    setEditing(true);
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await post({ action: "business_day", storeHours: hours, specialDays: special, leanBelowPct: lean, shortDayPct: shortDay, alertTimes: alerts, velocityDays: velocity, reorderToDays: reorderTo });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  const h = (s: string) => settings.storeHours[s] ?? settings.storeHours["*"];
  return (
    <Card
      title="Store hours, special days and alerts"
      intro="A day is compared (peak / lean days, averages, end-of-day report) only after the store closes and the bills are copied after closing. Today is shown as live."
      actions={
        editing ? (
          <div className="flex gap-2">
            <button className={primary} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className={`${sbtn} ring-1 ring-black/10`} disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className={`${sbtn} ring-1 ring-black/10 hover:bg-black/5`} onClick={start}>
            ✎ Edit
          </button>
        )
      }
    >
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
          <p className="text-xs font-bold uppercase tracking-wide text-black/45">Opening and closing time</p>
          {all.map((s) => (
            <div key={s} className="mt-1 flex flex-wrap items-center gap-2">
              <span className="w-36 font-semibold">{s === "*" ? "All stores (usual)" : s}</span>
              {editing ? (
                <>
                  <input type="time" className={`${input} w-28 py-1`} value={hours[s]?.open ?? ""} onChange={(e) => setHours({ ...hours, [s]: { ...(hours[s] ?? { open: "", close: "" }), open: e.target.value } })} />
                  to
                  <input type="time" className={`${input} w-28 py-1`} value={hours[s]?.close ?? ""} onChange={(e) => setHours({ ...hours, [s]: { ...(hours[s] ?? { open: "", close: "" }), close: e.target.value } })} />
                </>
              ) : (
                <span>
                  {h(s).open} – {h(s).close}
                  {s !== "*" && !settings.storeHours[s] ? <span className="text-xs text-black/40"> (usual)</span> : null}
                </span>
              )}
            </div>
          ))}
          {editing && <p className="mt-1 text-xs text-black/45">Leave a store empty to use the usual time.</p>}
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
            <p className="text-xs font-bold uppercase tracking-wide text-black/45">Holidays and special days (not compared)</p>
            {editing ? (
              <textarea className={`${input} mt-1`} rows={2} placeholder="2026-12-25, VATAKARA:2026-11-14" value={special} onChange={(e) => setSpecial(e.target.value)} />
            ) : (
              <p className="mt-1">{settings.specialDays.length ? settings.specialDays.join(", ") : "None"}</p>
            )}
          </div>
          <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
            <p className="text-xs font-bold uppercase tracking-wide text-black/45">Lean days</p>
            {editing ? (
              <div className="mt-1 space-y-1">
                <label className="flex items-center gap-2">
                  Lean when below <input className={`${input} w-16 py-1`} value={lean} onChange={(e) => setLean(e.target.value.replace(/[^\d]/g, ""))} /> % of a usual day
                </label>
                <label className="flex items-center gap-2">
                  Short day (not lean) below <input className={`${input} w-16 py-1`} value={shortDay} onChange={(e) => setShortDay(e.target.value.replace(/[^\d]/g, ""))} /> %
                </label>
              </div>
            ) : (
              <p className="mt-1">
                Lean below <b>{Math.round(settings.leanBelowPct * 100)}%</b> of a usual day; under {Math.round(settings.shortDayPct * 100)}% is a short day (closed early or data missing).
              </p>
            )}
          </div>
        </div>
        <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
          <p className="text-xs font-bold uppercase tracking-wide text-black/45">Performance alerts (store time)</p>
          {editing ? <input className={`${input} mt-1`} value={alerts} onChange={(e) => setAlerts(e.target.value)} placeholder="11:00, 14:00, 17:00, 20:00" /> : <p className="mt-1">{settings.alertTimes.join(" · ")}</p>}
        </div>
        <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
          <p className="text-xs font-bold uppercase tracking-wide text-black/45">Stock velocity</p>
          {editing ? (
            <div className="mt-1 space-y-1">
              <label className="flex items-center gap-2">
                Average daily sales over the last <input className={`${input} w-16 py-1`} value={velocity} onChange={(e) => setVelocity(e.target.value.replace(/[^\d]/g, ""))} /> days
              </label>
              <label className="flex items-center gap-2">
                Reorder up to <input className={`${input} w-16 py-1`} value={reorderTo} onChange={(e) => setReorderTo(e.target.value.replace(/[^\d]/g, ""))} /> days of stock
              </label>
            </div>
          ) : (
            <p className="mt-1">
              Average daily sales over <b>{settings.velocityDays}</b> days · reorder up to <b>{settings.reorderToDays}</b> days of stock
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

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

const formatDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

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
  type RowState = { sales: string; abv: string; group: IncentiveGroup; store: string; salary: string; staffId: string; staffFrom: string };
  // One row (or one store target) is changed at a time, each with its own Save.
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RowState | null>(null);
  const [editStore, setEditStore] = useState<string | null>(null);
  const [storeDraft, setStoreDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [showNone, setShowNone] = useState(false);

  const NO_STORE = "No store yet";
  const noOwnTarget = (g: string) => settings.noTargetGroups.includes(g) || settings.poolOnlyGroups.includes(g);
  const isCorporate = (p: Person) => !p.isPt && (!p.homeStore || !props.stores.includes(p.homeStore));
  const current = (p: Person): RowState => ({
    sales: props.targets[p.userId]?.sales ? String(props.targets[p.userId].sales) : "",
    abv: props.targets[p.userId]?.abv ? String(props.targets[p.userId].abv) : "",
    group: p.group,
    store: p.chosenStore ?? "",
    salary: props.salaries[p.userId] ? String(props.salaries[p.userId]) : "",
    staffId: "",
    staffFrom: "",
  });
  const groupNow = (p: Person) => (editId === p.userId && draft ? draft.group : p.group);
  const set = (change: Partial<RowState>) => setDraft((d) => (d ? { ...d, ...change } : d));

  const { byStore, notIn } = useMemo(() => {
    const out = new Map<string, Person[]>();
    const none: Person[] = [];
    for (const p of props.people) {
      if (p.group === "none") {
        none.push(p);
        continue;
      }
      const s = p.store && props.stores.includes(p.store) ? p.store : NO_STORE;
      if (!out.has(s)) out.set(s, []);
      out.get(s)!.push(p);
    }
    const excluded = settings.excludedStores.map((s) => s.toUpperCase());
    return {
      byStore: [...out.entries()]
        .filter(([s]) => !excluded.includes(s))
        .sort(([a], [b]) => (a === NO_STORE ? 1 : b === NO_STORE ? -1 : a.localeCompare(b))),
      notIn: none,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.people, props.stores, settings.excludedStores]);

  function startEdit(p: Person) {
    setEditStore(null);
    setEditId(p.userId);
    setDraft(current(p));
    setError("");
    setMsg("");
  }
  function cancel() {
    setEditId(null);
    setDraft(null);
    setEditStore(null);
    setError("");
  }

  async function saveRow(p: Person) {
    if (!draft) return;
    const was = current(p);
    // A temporary code that is really a permanent staff member: everything moves to their User ID.
    if (p.isPt && draft.staffId) {
      const who = props.people.find((x) => x.userId === draft.staffId);
      const from = draft.staffFrom;
      const what = from
        ? `Bills from ${formatDay(from)} on (and targets from ${monthLabel(from.slice(0, 7))}) count for ${draft.staffId}. Earlier bills stay with ${p.userId} as part-time, and ${p.userId} is marked as left the day before.`
        : `Their Zoho POS name, all bills, returns and targets move to ${draft.staffId}, and ${p.userId} is removed.`;
      if (!confirm(`${p.name} (${p.userId}) is ${who?.name ?? draft.staffId} (${draft.staffId})?\n\n${what}`)) return;
      setBusy(true);
      setError("");
      try {
        await post({ action: "pt_to_staff", code: p.userId, userId: draft.staffId, from: from || null });
        setEditId(null);
        setDraft(null);
        setMsg(`${p.name}: now counted as ${who?.name ?? draft.staffId} (${draft.staffId}).`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError("");
    try {
      // People not in incentive, and groups without individual targets (Store Manager, pool only), have no targets.
      const own = draft.group !== "none" && !noOwnTarget(draft.group);
      const sales = own ? draft.sales : "";
      const abv = own ? draft.abv : "";
      if (sales !== was.sales || abv !== was.abv) await post({ action: "targets", month, rows: [{ userId: p.userId, sales, abv }] });
      if (draft.salary !== was.salary) await post({ action: "salaries", rows: [{ userId: p.userId, salary: draft.salary }] });
      if (draft.group !== was.group) await post({ action: "group", staffId: p.id, group: draft.group });
      if (p.isPt && draft.store !== was.store) await post({ action: "pt_store", userId: p.userId, month, store: draft.store });
      setEditId(null);
      setDraft(null);
      setMsg(`${p.name}: saved.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function saveStoreTarget(store: string) {
    setBusy(true);
    setError("");
    try {
      const was = props.storeMonthTargets[store] ? String(props.storeMonthTargets[store]) : "";
      if (storeDraft !== was) await post({ action: "store_target", month, store, target: storeDraft });
      setEditStore(null);
      setMsg(`${store}: store target saved.`);
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
  const groupSelect = () => (
    <select className={`${input} py-1`} value={draft?.group ?? ""} onChange={(e) => set({ group: e.target.value })}>
      {groups.map((g) => (
        <option key={g.key} value={g.key}>
          {g.label}
        </option>
      ))}
    </select>
  );
  const transferLink = (
    <a href="/staff/team" className="font-semibold text-[#6f69c9] underline">
      Transfer
    </a>
  );
  const rowButtons = (p: Person) =>
    editId === p.userId ? (
      <span className="flex justify-end gap-1.5">
        <button className={`${sbtn} bg-[#8883d7] text-white`} disabled={busy} onClick={() => saveRow(p)}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className={`${sbtn} bg-white ring-1 ring-black/10`} disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </span>
    ) : (
      <button className={`${sbtn} bg-white ring-1 ring-black/10 hover:bg-black/5`} disabled={busy} onClick={() => startEdit(p)} aria-label={`Edit ${p.name}`}>
        ✎ Edit
      </button>
    );

  // Under the name: the person's store, and how it is changed.
  const storeLine = (p: Person, editing: boolean) => {
    if (p.isPt) {
      return editing ? (
        <span className="mt-1 block">
          <select className={`${input} w-56 py-1 text-xs`} value={draft?.store ?? ""} onChange={(e) => set({ store: e.target.value })}>
            <option value="">{p.soldMost ? `Where they sell most (${p.soldMost})` : "Where they sell most"}</option>
            {props.stores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-[11px] text-black/45">Store from {monthLabel(month)} on.</span>
          <select className={`${input} mt-2 w-56 py-1 text-xs`} value={draft?.staffId ?? ""} onChange={(e) => set({ staffId: e.target.value })}>
            <option value="">Not a permanent staff member</option>
            {props.people
              .filter((x) => !x.isPt)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((x) => (
                <option key={x.userId} value={x.userId}>
                  Permanent: {x.name} ({x.userId})
                </option>
              ))}
          </select>
          <span className="mt-0.5 block text-[11px] text-black/45">Permanent staff with a User ID? Choose them: their bills and targets move there.</span>
          {draft?.staffId && (
            <span className="mt-2 block space-y-1 text-[11px] text-black/60">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={!draft.staffFrom} onChange={() => set({ staffFrom: "" })} /> All their bills (always permanent)
              </label>
              <label className="flex flex-wrap items-center gap-1.5">
                <input type="radio" checked={!!draft.staffFrom} onChange={() => set({ staffFrom: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10) })} /> Permanent from
                <input
                  type="date"
                  className={`${input} w-36 py-0.5 text-[11px]`}
                  value={draft.staffFrom}
                  max={new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)}
                  onChange={(e) => set({ staffFrom: e.target.value })}
                />
                <span className="w-full text-black/45">Earlier bills stay part-time.</span>
              </label>
            </span>
          )}
        </span>
      ) : (
        <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Temporary{p.chosenStore ? "" : " · where they sell most"}</span>
      );
    }
    if (isCorporate(p)) {
      return (
        <>
          <span className="ml-1.5 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold text-black/50">
            {p.homeStore ?? "No store"}
            {p.chosenStore ? ` · shares ${p.chosenStore} pool` : ""}
          </span>
          {editing && <span className="mt-1 block text-[11px] text-black/45">Store changes with a {transferLink}.</span>}
        </>
      );
    }
    return editing ? <span className="mt-1 block text-[11px] text-black/45">Store changes with a {transferLink}.</span> : null;
  };

  return (
    <Card
      title={`Targets — ${monthLabel(month)}`}
      intro="Individual targets are net sales with GST, after discounts and returns. The Store Manager is measured on the store target; groups set to “No target — pool only” (e.g. data entry) only share the store pool. The group decides which part of the store pool a person shares. Press ✎ Edit on a person to change them. Permanent staff change store with a Transfer; temporary staff change store here."
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
          <button className={ghost} disabled={busy} onClick={copyLastMonth}>
            Copy from {monthLabel(shiftMonth(month, -1)).split(" ")[0]}
          </button>
        </>
      }
    >
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {msg && <p className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800">{msg}</p>}
      <div className="space-y-6">
        {byStore.map(([store, list]) => (
          <div key={store}>
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <h3 className={`text-base font-bold ${store === NO_STORE ? "text-amber-700" : ""}`}>{store}</h3>
              {store === NO_STORE && (
                <span className="text-sm text-black/55">
                  No sales this month and no store chosen. Temporary staff: choose their store with ✎ Edit. Permanent staff: use a {transferLink}.
                </span>
              )}
              {props.stores.includes(store) && (
                <span className="flex flex-wrap items-center gap-2 text-sm text-black/60">
                  Store target:
                  {editStore === store ? (
                    <>
                      <input
                        className={`${input} inline-block w-36 py-1`}
                        inputMode="numeric"
                        autoFocus
                        placeholder={settings.storeTargets[store] ? String(settings.storeTargets[store]) : "Default"}
                        value={storeDraft}
                        onChange={(e) => setStoreDraft(e.target.value.replace(/[^\d]/g, ""))}
                      />
                      <button className={`${sbtn} bg-[#8883d7] text-white`} disabled={busy} onClick={() => saveStoreTarget(store)}>
                        {busy ? "Saving…" : "Save"}
                      </button>
                      <button className={`${sbtn} bg-white ring-1 ring-black/10`} disabled={busy} onClick={cancel}>
                        Cancel
                      </button>
                      <span className="text-xs text-black/45">Empty = the usual store target{settings.storeTargets[store] ? ` (${rupees(settings.storeTargets[store])})` : ""}.</span>
                    </>
                  ) : (
                    <>
                      <b className="text-black">{storeTarget(store) ? rupees(storeTarget(store)) : "not set"}</b>
                      {props.storeMonthTargets[store] ? <span className="text-xs">(this month only)</span> : null}
                      <button
                        className={`${sbtn} bg-white ring-1 ring-black/10 hover:bg-black/5`}
                        disabled={busy}
                        onClick={() => {
                          setEditId(null);
                          setDraft(null);
                          setEditStore(store);
                          setStoreDraft(props.storeMonthTargets[store] ? String(props.storeMonthTargets[store]) : "");
                          setError("");
                          setMsg("");
                        }}
                      >
                        ✎ Edit
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[860px] table-fixed text-sm">
                <colgroup>
                  <col />
                  <col className="w-52" />
                  <col className="w-36" />
                  <col className="w-32" />
                  <col className="w-32" />
                  <col className="w-36" />
                </colgroup>
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-black/45">
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Group</th>
                    <th className="px-2 py-2 text-right">Sales target</th>
                    <th className="px-2 py-2 text-right">ABV target</th>
                    <th className="px-2 py-2 text-right" title="Only management sees salaries">Salary / month</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const editing = editId === p.userId && !!draft;
                    const t = props.targets[p.userId];
                    const g = groupNow(p);
                    return (
                      <tr key={p.id} className={`border-t border-black/5 align-top ${editing ? "bg-[#8883d7]/5" : ""}`}>
                        <td className="px-2 py-2">
                          <span className="font-semibold">{p.name}</span> <span className="text-xs text-black/40">{p.userId}</span>
                          {storeLine(p, editing)}
                        </td>
                        <td className="px-2 py-2">{editing ? groupSelect() : <span>{groupName(p.group, settings.groupLabels)}</span>}</td>
                        <td className="px-2 py-2 text-right">
                          {g === "none" ? (
                            <span className="text-xs text-black/45">Not in incentive</span>
                          ) : noOwnTarget(g) ? (
                            <span className="text-xs text-black/45">{settings.noTargetGroups.includes(g) ? "Store target" : "No target — pool only"}</span>
                          ) : editing ? (
                            <input className={`${input} py-1 text-right`} inputMode="numeric" placeholder="—" value={draft?.sales ?? ""} onChange={(e) => set({ sales: e.target.value.replace(/[^\d]/g, "") })} />
                          ) : t?.sales ? (
                            <b>{rupees(t.sales)}</b>
                          ) : (
                            <span className="text-black/30">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {g === "none" || noOwnTarget(g) ? (
                            <span className="text-xs text-black/30">—</span>
                          ) : editing ? (
                            <input className={`${input} py-1 text-right`} inputMode="numeric" placeholder="—" value={draft?.abv ?? ""} onChange={(e) => set({ abv: e.target.value.replace(/[^\d]/g, "") })} />
                          ) : t?.abv ? (
                            rupees(t.abv)
                          ) : (
                            <span className="text-black/30">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {editing ? (
                            <input className={`${input} py-1 text-right`} inputMode="numeric" placeholder="—" value={draft?.salary ?? ""} onChange={(e) => set({ salary: e.target.value.replace(/[^\d]/g, "") })} />
                          ) : props.salaries[p.userId] ? (
                            <span className="text-black/60">{rupees(props.salaries[p.userId])}</span>
                          ) : (
                            <span className="text-black/30">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">{rowButtons(p)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {notIn.length > 0 && (
          <details className="rounded-2xl ring-1 ring-black/5" open={showNone} onToggle={(e) => setShowNone((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer px-3 py-2.5 text-base font-bold">
              {groupName("none", settings.groupLabels)} <span className="text-sm font-normal text-black/50">({notIn.length}) — ✎ Edit to put someone in a group</span>
            </summary>
            <ul className="divide-y divide-black/5 border-t border-black/5">
              {notIn.map((p) => {
                const editing = editId === p.userId && !!draft;
                return (
                  <li key={p.id} className={`flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm ${editing ? "bg-[#8883d7]/5" : ""}`}>
                    <span>
                      <span className="font-semibold">{p.name}</span> <span className="text-xs text-black/40">{p.userId}</span>
                      {p.isPt ? (
                        <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Temporary</span>
                      ) : (
                        <span className="ml-1.5 text-xs text-black/45">{p.homeStore ?? ""}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {editing && <span className="w-56">{groupSelect()}</span>}
                      {rowButtons(p)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
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
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<string[]>(settings.excludedStores);
  const allStores = [...new Set([...stores, ...Object.keys(settings.storeTargets), ...settings.excludedStores])].sort();

  function start() {
    setPct(String(settings.highDiscountPct));
    setDuties(String(settings.dutiesRequired));
    setSps(settings.salesPerSalary ? String(settings.salesPerSalary) : "");
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
      await post({ action: "settings", highDiscountPct: pct, dutiesRequired: duties, storeTargets, excludedStores: excluded, salesPerSalary: sps });
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
          <p className="mt-1 text-sm">
            {settings.shifts.map((sh) => `${sh.name} ${sh.start}${sh.end ? `–${sh.end}` : ""}`).join(" · ")} — late when the first punch is more than <b>{settings.lateGraceMinutes} min</b> after the start of the person&apos;s shift that day.{" "}
            <a href="/staff/team" className="font-semibold text-[#5b55c9] underline">
              Change shifts, each person&apos;s shift and transfers →
            </a>
          </p>
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

type Unlinked = { name: string; userId: string; store: string; net: number; bills: number };

function LinksCard({ unlinked, people }: { unlinked: Unlinked[]; people: Person[] }) {
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
  async function addFormer(u: Unlinked) {
    if (!confirm(`Add ${u.name} as a former staff member (User ID ${u.userId}${u.store ? `, ${u.store}` : ""})?\n\nThey are added as inactive and cannot log in. You can activate them later in Staff Users if needed.`)) return;
    setBusy(u.name);
    setError("");
    try {
      await post({ action: "add_former", salesperson: u.name, userId: u.userId, store: u.store });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add.");
    } finally {
      setBusy("");
    }
  }
  return (
    <Card
      title="Salesperson names to link"
      intro="These salesperson names on Zoho bills have no User ID, or a User ID that no staff member has. Link each to the right person so their sales count for them — or, for someone who has left, Add them as former staff (inactive; activate later in Staff Users if needed)."
    >
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
              {busy === u.name ? "Saving…" : "Link"}
            </button>
            <button className={ghost} disabled={busy === u.name || !u.userId} onClick={() => addFormer(u)} title="Add as an inactive (former) staff member">
              ＋ Add as former staff
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export type AlertRunView = {
  day: string;
  slot: string;
  status: string;
  stale: boolean | null;
  started_at: string;
  result: {
    recipients: number;
    inApp: number;
    push: { devices: number; sent: number; failed: number; error: string | null };
    email: { sent: number; failed: number; skipped: number };
    error: string | null;
  } | null;
};

type StockTestRow = {
  store: string;
  summary: string;
  preview: string;
  wouldReach: number;
  delivered: { inApp: number; push: { devices: number; sent: number; failed: number; error: string | null }; email: { sent: number; failed: number; skipped: number } } | null;
};

type TestResult = {
  title: string;
  preview: string;
  stale: boolean;
  wouldReach: Record<AlertAudience, number>;
  delivered: { inApp: number; push: { devices: number; sent: number; failed: number; error: string | null }; email: { sent: number; failed: number; skipped: number } };
};

function AlertsCard({ settings, runs, isSuperAdmin, pushReady, emailReady }: { settings: PerformanceSettings; runs: AlertRunView[]; isSuperAdmin: boolean; pushReady: boolean; emailReady: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [on, setOn] = useState(settings.alertsOn);
  const [to, setTo] = useState<AlertAudience[]>(settings.alertTo);
  const [mail, setMail] = useState<AlertAudience[]>(settings.alertEmailTo);
  const [eodOn, setEodOn] = useState(settings.eodOn);
  const [eodMail, setEodMail] = useState<AlertAudience[]>(settings.eodEmailTo);
  const [stockOn, setStockOn] = useState(settings.stockAlertOn);
  const [stockTime, setStockTime] = useState(settings.stockAlertTime);
  const [stockMail, setStockMail] = useState<AlertAudience[]>(settings.stockAlertEmailTo);
  const [test, setTest] = useState<TestResult | null>(null);
  const [stockTest, setStockTest] = useState<StockTestRow[] | null>(null);
  const toggle = (list: AlertAudience[], k: AlertAudience) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  function start() {
    setOn(settings.alertsOn);
    setTo(settings.alertTo);
    setMail(settings.alertEmailTo);
    setEodOn(settings.eodOn);
    setEodMail(settings.eodEmailTo);
    setStockOn(settings.stockAlertOn);
    setStockTime(settings.stockAlertTime);
    setStockMail(settings.stockAlertEmailTo);
    setError("");
    setEditing(true);
  }
  async function save() {
    const changes: string[] = [];
    if (on !== settings.alertsOn) changes.push(`Sales update alerts: ${on ? "ON" : "off"}`);
    if (eodOn !== settings.eodOn) changes.push(`End-of-day reports: ${eodOn ? "ON" : "off"}`);
    if (stockOn !== settings.stockAlertOn) changes.push(`Daily stock alert: ${stockOn ? "ON" : "off"}`);
    if (changes.length && !window.confirm(`Save these changes?\n\n${changes.join("\n")}`)) return;
    setBusy(true);
    setError("");
    try {
      await post({ action: "alert_plan", alertsOn: on, alertTo: to, alertEmailTo: mail, eodOn, eodEmailTo: eodMail, stockAlertOn: stockOn, stockAlertTime: stockTime, stockAlertEmailTo: stockMail });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  async function sendTest() {
    setBusy(true);
    setError("");
    setTest(null);
    try {
      setTest((await post({ action: "alert_test" })) as TestResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the test.");
    } finally {
      setBusy(false);
    }
  }
  async function sendStockTest() {
    setBusy(true);
    setError("");
    setStockTest(null);
    try {
      setStockTest(((await post({ action: "stock_alert_test" })) as { stores: StockTestRow[] }).stores);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the test.");
    } finally {
      setBusy(false);
    }
  }
  const names = (list: AlertAudience[]) => (list.length ? ALERT_AUDIENCES.filter((a) => list.includes(a.key)).map((a) => a.label).join(", ") : "No one");
  const box = "rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5";
  const label = "text-xs font-bold uppercase tracking-wide text-black/45";
  return (
    <Card
      title="Sales alerts, stock alerts & end-of-day reports"
      intro={`Sales updates at ${settings.alertTimes.join(", ")} (change the times above) and a report per store after closing. Everyone chosen gets them in the app and as a phone / browser notification; e-mail only for the groups ticked.`}
      actions={
        editing ? (
          <div className="flex gap-2">
            <button className={primary} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className={`${sbtn} ring-1 ring-black/10`} disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            {isSuperAdmin && (
              <>
                <button className={`${sbtn} bg-[#0b7f91] text-white`} disabled={busy} onClick={sendTest}>
                  {busy ? "Sending…" : "Test sales update"}
                </button>
                <button className={`${sbtn} bg-[#b45309] text-white`} disabled={busy} onClick={sendStockTest}>
                  {busy ? "Sending…" : "Test stock alert"}
                </button>
              </>
            )}
            <button className={`${sbtn} ring-1 ring-black/10 hover:bg-black/5`} onClick={start}>
              ✎ Edit
            </button>
          </div>
        )
      }
    >
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-semibold ${pushReady ? "bg-green-50 text-green-700" : "bg-amber-100 text-amber-800"}`}>
          Phone notifications: {pushReady ? "set up" : "not set up (Firebase key missing — in-app and e-mail still work)"}
        </span>
        <span className={`rounded-full px-2.5 py-1 font-semibold ${emailReady ? "bg-green-50 text-green-700" : "bg-amber-100 text-amber-800"}`}>
          E-mail: {emailReady ? "set up" : "not set up (Alerts Setup)"}
        </span>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className={box}>
          <p className={label}>Sales updates during the day</p>
          {editing ? (
            <div className="mt-1 space-y-2">
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={on} disabled={!isSuperAdmin && !settings.alertsOn} onChange={(e) => setOn(e.target.checked)} /> Send sales updates
              </label>
              <p className="text-xs text-black/45">Who gets them / who also gets an e-mail:</p>
              {ALERT_AUDIENCES.map((a) => (
                <div key={a.key} className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={to.includes(a.key)} onChange={() => setTo(toggle(to, a.key))} /> {a.label}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-black/55">
                    <input type="checkbox" checked={mail.includes(a.key)} onChange={() => setMail(toggle(mail, a.key))} /> e-mail
                  </label>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-1 space-y-1">
              <p>
                <b className={settings.alertsOn ? "text-green-700" : "text-black/50"}>{settings.alertsOn ? "ON" : "OFF"}</b> · to {names(settings.alertTo)}
              </p>
              <p className="text-xs text-black/55">E-mail also to: {names(settings.alertEmailTo)}</p>
            </div>
          )}
        </div>
        <div className={box}>
          <p className={label}>End-of-day report per store</p>
          {editing ? (
            <div className="mt-1 space-y-2">
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={eodOn} disabled={!isSuperAdmin && !settings.eodOn} onChange={(e) => setEodOn(e.target.checked)} /> Make the report after closing
              </label>
              <p className="text-xs text-black/45">E-mail it to:</p>
              {ALERT_AUDIENCES.filter((a) => a.key !== "staff").map((a) => (
                <label key={a.key} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={eodMail.includes(a.key)} onChange={() => setEodMail(toggle(eodMail, a.key))} /> {a.label}
                </label>
              ))}
            </div>
          ) : (
            <div className="mt-1 space-y-1">
              <p>
                <b className={settings.eodOn ? "text-green-700" : "text-black/50"}>{settings.eodOn ? "ON" : "OFF"}</b> · e-mailed to {names(settings.eodEmailTo)}
              </p>
              <p className="text-xs text-black/55">
                Kept on{" "}
                <a href="/staff/performance/reports" className="font-semibold text-[#5b55c4] underline">
                  End-of-day reports
                </a>
                .
              </p>
            </div>
          )}
        </div>
      </div>
      <div className={`${box} mt-3 text-sm`}>
        <p className={label}>Daily stock alert per store (fast movers low / out of stock)</p>
        {editing ? (
          <div className="mt-1 space-y-2">
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={stockOn} disabled={!isSuperAdmin && !settings.stockAlertOn} onChange={(e) => setStockOn(e.target.checked)} /> Send the stock alert every day at
              <input type="time" className={`${input} w-28 py-1`} value={stockTime} onChange={(e) => setStockTime(e.target.value)} />
            </label>
            <p className="text-xs text-black/45">Goes to the store’s Store Manager / ASM and management in the app and as a phone notification. E-mail it to:</p>
            {ALERT_AUDIENCES.filter((a) => a.key !== "staff").map((a) => (
              <label key={a.key} className="flex items-center gap-1.5">
                <input type="checkbox" checked={stockMail.includes(a.key)} onChange={() => setStockMail(toggle(stockMail, a.key))} /> {a.label}
              </label>
            ))}
          </div>
        ) : (
          <div className="mt-1 space-y-1">
            <p>
              <b className={settings.stockAlertOn ? "text-green-700" : "text-black/50"}>{settings.stockAlertOn ? "ON" : "OFF"}</b> · every day at {settings.stockAlertTime} (after the 11:30 pm stock read) · e-mailed to {names(settings.stockAlertEmailTo)}
            </p>
            <p className="text-xs text-black/55">Lists each fast mover running low or out with stock, sales a day, days left and how much to reorder, plus the best sellers that are out of stock. Not sent when nothing is low.</p>
          </div>
        )}
      </div>
      {stockTest && (
        <div className="mt-4 space-y-3 rounded-2xl bg-amber-50 p-4 text-sm ring-1 ring-amber-200">
          <p className="font-bold">Stock alert test — sent to you only</p>
          {stockTest.map((r) => (
            <div key={r.store}>
              <p className="font-semibold">
                {r.store}: {r.summary}
              </p>
              {r.delivered && (
                <p className="text-xs text-black/60">
                  In the app: {r.delivered.inApp ? "yes" : "no"} · phone: {r.delivered.push.error ? r.delivered.push.error : `${r.delivered.push.sent} of ${r.delivered.push.devices} device(s)`} · e-mail:{" "}
                  {r.delivered.email.sent ? "sent" : r.delivered.email.failed ? "failed" : "not sent"} · when on, it would reach {r.wouldReach} person(s)
                </p>
              )}
              {r.preview && <pre className="mt-1 whitespace-pre-wrap rounded-xl bg-white p-3 text-xs ring-1 ring-black/5">{r.preview}</pre>}
            </div>
          ))}
        </div>
      )}
      {test && (
        <div className="mt-4 rounded-2xl bg-[#0b7f91]/5 p-4 text-sm ring-1 ring-[#0b7f91]/20">
          <p className="font-bold">Test sent to you only: {test.title}</p>
          <p className="mt-1 text-xs text-black/60">
            In the app: {test.delivered.inApp ? "yes" : "no"} · phone notification:{" "}
            {test.delivered.push.error ? test.delivered.push.error : `${test.delivered.push.sent} of ${test.delivered.push.devices} device(s)`} · e-mail:{" "}
            {test.delivered.email.sent ? "sent" : test.delivered.email.failed ? "failed" : "not sent (no e-mail address or e-mail not set up)"}
            {test.stale ? " · figures were NOT up to date" : ""}
          </p>
          <p className="mt-1 text-xs text-black/60">
            When switched on, a run now would reach: {test.wouldReach.staff} sales staff, {test.wouldReach.sm} store manager(s), {test.wouldReach.management} in management.
          </p>
          <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-white p-3 text-xs ring-1 ring-black/5">{test.preview}</pre>
        </div>
      )}
      <div className="mt-4">
        <p className={label}>Last runs</p>
        {runs.length ? (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-black/45">
                  <th className="py-1 pr-3">Day</th>
                  <th className="pr-3">Time</th>
                  <th className="pr-3">Status</th>
                  <th className="pr-3">People</th>
                  <th className="pr-3">In app</th>
                  <th className="pr-3">Phone</th>
                  <th className="pr-3">E-mail</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={`${r.day}|${r.slot}`} className="border-t border-black/5">
                    <td className="py-1 pr-3">{fmtDate(r.day)}</td>
                    <td className="pr-3">{r.slot}</td>
                    <td className={`pr-3 font-semibold ${r.status === "sent" ? "text-green-700" : r.status === "failed" ? "text-red-700" : "text-black/50"}`}>
                      {r.status}
                      {r.stale ? " · data not up to date" : ""}
                      {r.result?.error ? ` · ${r.result.error}` : ""}
                    </td>
                    <td className="pr-3">{r.result?.recipients ?? "—"}</td>
                    <td className="pr-3">{r.result?.inApp ?? "—"}</td>
                    <td className="pr-3">{r.result ? (r.result.push.error ? "not set up" : `${r.result.push.sent}/${r.result.push.devices}`) : "—"}</td>
                    <td className="pr-3">{r.result ? `${r.result.email.sent} sent${r.result.email.failed ? `, ${r.result.email.failed} failed` : ""}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-1 text-sm text-black/50">No runs yet.</p>
        )}
      </div>
    </Card>
  );
}
