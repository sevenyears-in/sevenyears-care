"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GROUP_LABEL, INCENTIVE_GROUPS, rupees, type IncentiveGroup, type PerformanceSettings } from "@/lib/performance-rules";

type Person = { id: string; userId: string; name: string; roleLabel: string; store: string | null; group: IncentiveGroup; groupChosen: boolean };
type Promo = { id: number; kind: "slow_moving" | "b2g1"; item_id: string | null; sku: string | null; name: string; from_date: string | null; to_date: string | null };
type ZItem = { item_id: string; name: string; sku: string | null; rate: number; category: string };

const btn = "rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50";
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
  promos: Promo[];
  unlinked: { name: string; net: number; bills: number }[];
  billsCopied: number;
  lastBillDate: string | null;
}) {
  return (
    <div className="space-y-6">
      <SyncCard month={props.month} today={props.today} settings={props.settings} billsCopied={props.billsCopied} lastBillDate={props.lastBillDate} />
      <TargetsCard {...props} />
      <PromoCard promos={props.promos} />
      <SettingsCard settings={props.settings} stores={props.stores} />
      {props.unlinked.length > 0 && <LinksCard unlinked={props.unlinked} people={props.people} />}
    </div>
  );
}

// ------------------------------------------------------------------
// Copy bills from Zoho
// ------------------------------------------------------------------

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
}) {
  const router = useRouter();
  const { month, settings } = props;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const startRows = () =>
    Object.fromEntries(
      props.people.map((p) => [p.userId, { sales: props.targets[p.userId]?.sales ? String(props.targets[p.userId].sales) : "", abv: props.targets[p.userId]?.abv ? String(props.targets[p.userId].abv) : "", group: p.group }])
    );
  const [rows, setRows] = useState<Record<string, { sales: string; abv: string; group: IncentiveGroup }>>(startRows);
  const startStores = () => Object.fromEntries(props.stores.map((s) => [s, props.storeMonthTargets[s] ? String(props.storeMonthTargets[s]) : ""]));
  const [storeRows, setStoreRows] = useState<Record<string, string>>(startStores);

  const byStore = useMemo(() => {
    const out = new Map<string, Person[]>();
    for (const p of props.people) {
      const s = p.store ?? "No store";
      if (!out.has(s)) out.set(s, []);
      out.get(s)!.push(p);
    }
    const excluded = settings.excludedStores.map((s) => s.toUpperCase());
    return [...out.entries()]
      .filter(([s]) => !excluded.includes(s))
      .sort(([a], [b]) => (a === "CORPORATE OFFICE" ? 1 : b === "CORPORATE OFFICE" ? -1 : a.localeCompare(b)));
  }, [props.people, settings.excludedStores]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await post({ action: "targets", month, rows: Object.entries(rows).map(([userId, r]) => ({ userId, sales: r.sales, abv: r.abv })) });
      for (const p of props.people) {
        if (rows[p.userId] && rows[p.userId].group !== p.group) await post({ action: "group", staffId: p.id, group: rows[p.userId].group });
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

  return (
    <Card
      title={`Targets — ${monthLabel(month)}`}
      intro="Individual targets are without tax, after discounts and returns. The group decides which part of the store pool a person shares."
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
              <h3 className="text-base font-bold">{store}</h3>
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
              <table className="min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-black/45">
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Role</th>
                    <th className="px-2 py-2">Group</th>
                    <th className="px-2 py-2 text-right">Sales target</th>
                    <th className="px-2 py-2 text-right">ABV target</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const r = rows[p.userId];
                    const t = props.targets[p.userId];
                    return (
                      <tr key={p.id} className="border-t border-black/5">
                        <td className="px-2 py-2">
                          <span className="font-semibold">{p.name}</span> <span className="text-xs text-black/40">{p.userId}</span>
                        </td>
                        <td className="px-2 py-2 text-black/60">{p.roleLabel}</td>
                        <td className="px-2 py-2">
                          {editing ? (
                            <select className={`${input} py-1`} value={r?.group ?? p.group} onChange={(e) => setRows({ ...rows, [p.userId]: { ...r, group: e.target.value as IncentiveGroup } })}>
                              {INCENTIVE_GROUPS.map((g) => (
                                <option key={g.key} value={g.key}>
                                  {g.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className={p.group === "none" ? "text-black/35" : ""}>{GROUP_LABEL[p.group]}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {editing ? (
                            <input className={`${input} w-32 py-1 text-right`} inputMode="numeric" placeholder="—" value={r?.sales ?? ""} onChange={(e) => setRows({ ...rows, [p.userId]: { ...r, sales: e.target.value.replace(/[^\d]/g, "") } })} />
                          ) : t?.sales ? (
                            <b>{rupees(t.sales)}</b>
                          ) : (
                            <span className="text-black/30">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {editing ? (
                            <input className={`${input} w-28 py-1 text-right`} inputMode="numeric" placeholder="—" value={r?.abv ?? ""} onChange={(e) => setRows({ ...rows, [p.userId]: { ...r, abv: e.target.value.replace(/[^\d]/g, "") } })} />
                          ) : t?.abv ? (
                            rupees(t.abv)
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
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Slow-moving and Buy 2 Get 1 products
// ------------------------------------------------------------------

function PromoCard({ promos }: { promos: Promo[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"slow_moving" | "b2g1">("slow_moving");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ZItem[] | null>(null);
  const [picked, setPicked] = useState<Record<string, ZItem>>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = promos.filter((p) => p.kind === tab);

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
      await post({ action: "promo_add", kind: tab, items: Object.values(picked), from: from || null, to: to || null });
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
    if (!confirm(`Remove “${p.name}” from the ${tab === "b2g1" ? "Buy 2 Get 1" : "Slow-moving"} list?`)) return;
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
      title="Slow-moving and Buy 2 Get 1 products"
      intro={tab === "b2g1" ? "₹10 for every unit of these products sold (returns are taken off)." : "₹100 / ₹200 / ₹300 a month for ₹1,000+ / ₹5,001+ / ₹10,001+ of these products sold."}
    >
      <div className="mb-4 inline-flex rounded-full bg-black/[0.04] p-1">
        {(["slow_moving", "b2g1"] as const).map((k) => (
          <button
            key={k}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === k ? "bg-white shadow ring-1 ring-black/5" : "text-black/55"}`}
            onClick={() => {
              setTab(k);
              setPicked({});
            }}
          >
            {k === "b2g1" ? "Buy 2 Get 1" : "Slow-moving"} ({promos.filter((p) => p.kind === k).length})
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
              const already = promos.some((p) => p.kind === tab && p.item_id === i.item_id);
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
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<string[]>(settings.excludedStores);
  const allStores = [...new Set([...stores, ...Object.keys(settings.storeTargets), ...settings.excludedStores])].sort();

  function start() {
    setPct(String(settings.highDiscountPct));
    setDuties(String(settings.dutiesRequired));
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
      await post({ action: "settings", highDiscountPct: pct, dutiesRequired: duties, storeTargets, excludedStores: excluded });
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
