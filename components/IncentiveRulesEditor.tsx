"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { groupName, type IncentiveGroup } from "@/lib/performance-rules";
import {
  PERIOD_LABEL,
  RULE_PERIOD,
  KIND_HELP,
  KIND_LABEL,
  ruleStatus,
  ruleSummary,
  type IncentiveRule,
  type RuleKind,
} from "@/lib/incentive-rules";

const btn = "rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50";
const primary = `${btn} bg-[#8883d7] text-white hover:opacity-90`;
const ghost = `${btn} bg-white ring-1 ring-black/10 hover:bg-black/5`;
const small = "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 disabled:opacity-50";
const input = "w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[#8883d7]";

const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "");

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/staff/admin/performance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

/** Number box that keeps what is typed and reports a number (or NaN). `scale` 100 = shown as %. */
function Num({ value, onChange, scale = 1, prefix, suffix, width = "w-28" }: { value: number; onChange: (v: number) => void; scale?: number; prefix?: string; suffix?: string; width?: string }) {
  const show = (v: number) => (Number.isFinite(v) ? String(Math.round(v * scale * 1000) / 1000) : "");
  const [text, setText] = useState(show(value));
  return (
    <span className="inline-flex items-center gap-1">
      {prefix && <span className="text-sm text-black/50">{prefix}</span>}
      <input
        className={`${input} ${width} py-1.5 text-right`}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, "");
          setText(t);
          onChange(t === "" ? NaN : Number(t) / scale);
        }}
      />
      {suffix && <span className="text-sm text-black/50">{suffix}</span>}
    </span>
  );
}

type G = { key: string; label: string };

function blank(kind: RuleKind, today: string, groups: G[]): IncentiveRule {
  const base = { id: "", name: "", groups: groups.map((g) => g.key) as IncentiveGroup[], from: today, to: null };
  switch (kind) {
    case "store_pool":
      return { ...base, kind, slabs: [{ from: 1, rate: 0.01 }], split: { sales: 1 } };
    case "achievement":
      return { ...base, kind, groups: ["sales"], slabs: [{ from: 1, amount: 1000 }] };
    case "abv":
      return { ...base, kind, groups: ["sales"], slabs: [{ from: 1, abv: 2000, amount: 1000 }] };
    case "bill_value":
      return { ...base, kind, minBill: 25000, amount: 200 };
    case "wow":
      return { ...base, kind, minBill: 10000, minItems: 4, minCategories: 3, minCheap: 3, maxShare: 0.6, amount: 250 };
    case "product_units":
      return { ...base, kind, list: "", amount: 10, freeNotDiscount: false };
    case "product_value":
      return { ...base, kind, list: "", slabs: [{ from: 1000, amount: 100 }] };
    case "yearly_achievement":
      return { ...base, kind, groups: ["sales"], slabs: [{ from: 1, amount: 5000 }] };
  }
}

// ------------------------------------------------------------------

export function IncentiveRulesEditor({
  rules,
  today,
  labels,
  groups: allGroups,
}: {
  rules: IncentiveRule[];
  today: string;
  labels: Partial<Record<IncentiveGroup, string>>;
  /** Groups that can be given an incentive (everything except "Not in incentive"). */
  groups: G[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ rule: IncentiveRule; isNew: boolean } | null>(null);
  const [stopping, setStopping] = useState<{ id: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newKind, setNewKind] = useState<RuleKind>("bill_value");

  // Daily, monthly and yearly incentives; inside each, in force first, then later, then stopped.
  const order = { active: 0, scheduled: 1, ended: 2 } as const;
  const groups = (["daily", "monthly", "yearly"] as const).map((pd) => ({
    pd,
    list: rules.filter((r) => RULE_PERIOD[r.kind] === pd).sort((a, b) => order[ruleStatus(a, today)] - order[ruleStatus(b, today)]),
  }));

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await post(body);
      setEditing(null);
      setStopping(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="relative overflow-hidden rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6">
      <span className="absolute inset-y-0 left-0 w-1.5 bg-[#8883d7]" aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Incentives</h2>
          <p className="mt-0.5 max-w-3xl text-sm text-black/55">
            Change an amount or who is eligible from a date, stop an incentive from a date, or add a new one. Earlier months keep the rules that were in force then.
            Monthly incentives use the rules in force on the last day of the month; per-bill and per-item incentives use the rules on the day of the bill.
          </p>
        </div>
        {!editing && (
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${input} w-auto py-2`} value={newKind} onChange={(e) => setNewKind(e.target.value as RuleKind)}>
              {(["daily", "monthly", "yearly"] as const).map((pd) => (
                <optgroup key={pd} label={PERIOD_LABEL[pd].title}>
                  {(Object.keys(KIND_LABEL) as RuleKind[])
                    .filter((k) => RULE_PERIOD[k] === pd)
                    .map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <button className={primary} onClick={() => setEditing({ rule: blank(newKind, today, allGroups), isNew: true })}>
              + New incentive
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {editing && (
        <RuleForm
          key={editing.rule.id || "new"}
          start={editing.rule}
          isNew={editing.isNew}
          today={today}
          labels={labels}
          groups={allGroups}
          busy={busy}
          onCancel={() => {
            setEditing(null);
            setError("");
          }}
          onSave={(rule) => run({ action: "rule_save", rule })}
        />
      )}

      <div className="mt-5 space-y-6">
        {groups.map(({ pd, list }) => (
            <div key={pd}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-base font-bold">{PERIOD_LABEL[pd].title} incentives</h3>
                <span className="text-xs text-black/50">{PERIOD_LABEL[pd].help}</span>
              </div>
              {list.length === 0 && <p className="rounded-2xl px-4 py-3 text-sm text-black/45 ring-1 ring-black/5">None yet — add one with “+ New incentive”.</p>}
              <ul className={`divide-y divide-black/5 rounded-2xl ring-1 ring-black/5 ${list.length ? "" : "hidden"}`}>
                {list.map((r) => {
                  const st = ruleStatus(r, today);
                  return (
                  <li key={r.id} className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 ${st === "ended" ? "opacity-60" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {r.name}{" "}
                        <span
                          className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            st === "active" ? "bg-green-100 text-green-800" : st === "scheduled" ? "bg-amber-100 text-amber-800" : "bg-black/5 text-black/50"
                          }`}
                        >
                          {st === "active" ? "In force" : st === "scheduled" ? "Starts later" : "Stopped"}
                        </span>{" "}
                        <span className="ml-1 text-xs font-normal text-black/45">{KIND_LABEL[r.kind]}</span>
                      </p>
                      <p className="mt-0.5 text-sm text-black/70">{ruleSummary(r)}</p>
                      <p className="mt-1 flex flex-wrap gap-1">
                        {r.kind === "store_pool"
                          ? (Object.entries(r.split) as [IncentiveGroup, number][])
                              .filter(([, v]) => v)
                              .map(([g, v]) => (
                                <span key={g} className="rounded-full bg-[#8883d7]/10 px-2 py-0.5 text-[11px] font-semibold text-[#5b55c9]">
                                  {groupName(g, labels)} {Math.round(v * 1000) / 10}%
                                </span>
                              ))
                          : r.groups.map((g) => (
                              <span key={g} className="rounded-full bg-[#8883d7]/10 px-2 py-0.5 text-[11px] font-semibold text-[#5b55c9]">
                                {groupName(g, labels)}
                              </span>
                            ))}
                      </p>
                      <p className="mt-1 text-xs text-black/45">
                        {r.from ? `From ${fmtDate(r.from)}` : "From the start"} · {r.to ? `until ${fmtDate(r.to)}` : "no end date"}
                      </p>
                      {stopping?.id === r.id && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-red-50/60 p-2.5 text-sm">
                          Last day in force:
                          <input type="date" className={`${input} w-auto py-1`} value={stopping.to} min={r.from ?? undefined} onChange={(e) => setStopping({ id: r.id, to: e.target.value })} />
                          <button className={`${small} bg-red-600 text-white ring-red-600`} disabled={busy || !stopping.to} onClick={() => run({ action: "rule_stop", id: r.id, to: stopping.to })}>
                            Stop
                          </button>
                          <button className={`${small} bg-white ring-black/10`} disabled={busy} onClick={() => setStopping(null)}>
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                    {!editing && stopping?.id !== r.id && (
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {st !== "ended" && (
                          <button className={`${small} bg-white ring-black/10 hover:bg-black/5`} onClick={() => setEditing({ rule: { ...r, from: st === "scheduled" ? r.from : today } as IncentiveRule, isNew: false })}>
                            ✎ Change
                          </button>
                        )}
                        {st !== "ended" && !r.to && (
                          <button className={`${small} bg-white text-red-700 ring-red-200 hover:bg-red-50`} onClick={() => setStopping({ id: r.id, to: today })}>
                            Stop
                          </button>
                        )}
                        {r.to && st !== "ended" && (
                          <button className={`${small} bg-white ring-black/10 hover:bg-black/5`} disabled={busy} onClick={() => run({ action: "rule_restart", id: r.id })}>
                            Remove end date
                          </button>
                        )}
                        {st === "scheduled" && (
                          <button
                            className={`${small} bg-white text-red-700 ring-red-200 hover:bg-red-50`}
                            disabled={busy}
                            onClick={() => confirm(`Delete “${r.name}”? It has not started yet.`) && run({ action: "rule_delete", id: r.id })}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                  );
                })}
              </ul>
            </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-black/55">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function RuleForm({
  start,
  isNew,
  today,
  labels,
  groups: allGroups,
  busy,
  onCancel,
  onSave,
}: {
  start: IncentiveRule;
  isNew: boolean;
  today: string;
  labels: Partial<Record<IncentiveGroup, string>>;
  groups: G[];
  busy: boolean;
  onCancel: () => void;
  onSave: (r: IncentiveRule) => void;
}) {
  const [r, setR] = useState<IncentiveRule>(start);
  const set = (change: Partial<IncentiveRule>) => setR({ ...r, ...change } as IncentiveRule);
  const toggle = (g: IncentiveGroup) => set({ groups: r.groups.includes(g) ? r.groups.filter((x) => x !== g) : [...r.groups, g] });

  type AnySlab = { from: number; amount?: number; rate?: number; abv?: number };
  const slabs = "slabs" in r ? (r.slabs as AnySlab[]) : [];
  const setSlab = (i: number, change: Partial<AnySlab>) => set({ slabs: slabs.map((s, k) => (k === i ? { ...s, ...change } : s)) } as Partial<IncentiveRule>);
  const addSlab = () => {
    const last = slabs[slabs.length - 1] ?? { from: 0, amount: 0, rate: 0, abv: 0 };
    set({ slabs: [...slabs, { ...last }] } as Partial<IncentiveRule>);
  };
  const removeSlab = (i: number) => set({ slabs: slabs.filter((_, k) => k !== i) } as Partial<IncentiveRule>);
  const splitTotal = r.kind === "store_pool" ? Object.values(r.split).reduce((s: number, v) => s + (Number.isFinite(v) ? (v as number) : 0), 0) : 0;

  return (
    <div className="mt-4 rounded-2xl bg-[#8883d7]/[0.06] p-4 ring-1 ring-[#8883d7]/20 sm:p-5">
      <p className="text-sm font-bold">
        {isNew ? `New incentive — ${KIND_LABEL[r.kind]}` : `Change “${start.name}”`}
      </p>
      <p className="mt-0.5 text-xs text-black/55">{KIND_HELP[r.kind]}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input className={input} value={r.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Festival bill bonus" />
        </Field>
        <Field label={isNew ? "Starts on" : "Change takes effect from"}>
          <input type="date" className={input} value={r.from ?? ""} onChange={(e) => set({ from: e.target.value || null })} />
          {!isNew && start.from !== r.from && <p className="mt-1 text-[11px] text-black/50">The current version stays in force until the day before.</p>}
        </Field>
      </div>

      {r.kind !== "store_pool" && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-black/55">Who is eligible</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {allGroups.map(({ key: g, label }) => (
              <label key={g} className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ring-1 ${r.groups.includes(g) ? "bg-white ring-[#8883d7]" : "bg-white/60 ring-black/10"}`}>
                <input type="checkbox" checked={r.groups.includes(g)} onChange={() => toggle(g)} />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {r.kind === "store_pool" && (
          <>
            <p className="text-xs font-semibold text-black/55">Store achievement → pool (share of the store&apos;s net sales)</p>
            {r.slabs.map((s, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                From <Num value={s.from} scale={100} suffix="% of target" onChange={(v) => setSlab(i, { from: v })} />→
                <Num value={s.rate} scale={100} suffix="% of sales" width="w-20" onChange={(v) => setSlab(i, { rate: v })} />
                <button className="text-xs text-red-700" onClick={() => removeSlab(i)}>
                  remove
                </button>
              </div>
            ))}
            <button className="text-sm font-semibold text-[#5b55c9]" onClick={addSlab}>
              + Add level
            </button>
            <p className="pt-2 text-xs font-semibold text-black/55">Share of the pool for each group (Sales Team by their sales, the others equally)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {allGroups.map(({ key: g, label }) => (
                <div key={g} className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-1.5 text-sm ring-1 ring-black/5">
                  {label}
                  <Num value={r.split[g] ?? 0} scale={100} suffix="%" width="w-20" onChange={(v) => set({ split: { ...r.split, [g]: v } })} />
                </div>
              ))}
            </div>
            <p className={`text-xs ${splitTotal > 1.0001 ? "font-semibold text-red-700" : "text-black/50"}`}>Total {Math.round(splitTotal * 1000) / 10}% (must not be more than 100%)</p>
          </>
        )}

        {r.kind === "yearly_achievement" &&
          r.slabs.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              From <Num value={s.from} scale={100} suffix="% of the year's target" onChange={(v) => setSlab(i, { from: v })} />→
              <Num value={s.amount} prefix="₹" onChange={(v) => setSlab(i, { amount: v })} />
              <button className="text-xs text-red-700" onClick={() => removeSlab(i)}>
                remove
              </button>
            </div>
          ))}

        {r.kind === "achievement" &&
          r.slabs.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              From <Num value={s.from} scale={100} suffix="% of own target" onChange={(v) => setSlab(i, { from: v })} />→
              <Num value={s.amount} prefix="₹" onChange={(v) => setSlab(i, { amount: v })} />
              <button className="text-xs text-red-700" onClick={() => removeSlab(i)}>
                remove
              </button>
            </div>
          ))}

        {r.kind === "abv" &&
          r.slabs.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <Num value={s.from} scale={100} suffix="% of target" onChange={(v) => setSlab(i, { from: v })} /> and ABV
              <Num value={s.abv} prefix="₹" onChange={(v) => setSlab(i, { abv: v })} />→
              <Num value={s.amount} prefix="₹" onChange={(v) => setSlab(i, { amount: v })} />
              <button className="text-xs text-red-700" onClick={() => removeSlab(i)}>
                remove
              </button>
            </div>
          ))}

        {r.kind === "product_value" && (
          <>
            {r.slabs.map((s, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                Sold for <Num value={s.from} prefix="₹" suffix="or more in the month" onChange={(v) => setSlab(i, { from: v })} />→
                <Num value={s.amount} prefix="₹" onChange={(v) => setSlab(i, { amount: v })} />
                <button className="text-xs text-red-700" onClick={() => removeSlab(i)}>
                  remove
                </button>
              </div>
            ))}
            <p className="text-xs text-black/50">Add the products under “Products for incentives” after saving.</p>
          </>
        )}

        {(r.kind === "achievement" || r.kind === "abv" || r.kind === "product_value" || r.kind === "yearly_achievement") && (
          <button className="text-sm font-semibold text-[#5b55c9]" onClick={addSlab}>
            + Add level
          </button>
        )}

        {r.kind === "bill_value" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Num value={r.amount} prefix="₹" onChange={(v) => set({ amount: v })} /> for every bill of
            <Num value={r.minBill} prefix="₹" suffix="or more (with tax)" onChange={(v) => set({ minBill: v })} />
          </div>
        )}

        {r.kind === "wow" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount per WOW bill">
              <Num value={r.amount} prefix="₹" onChange={(v) => set({ amount: v })} />
            </Field>
            <Field label="Bill value (with tax) at least">
              <Num value={r.minBill} prefix="₹" onChange={(v) => set({ minBill: v })} />
            </Field>
            <Field label="Items in the bill at least">
              <Num value={r.minItems} onChange={(v) => set({ minItems: v })} />
            </Field>
            <Field label="Product categories at least">
              <Num value={r.minCategories} onChange={(v) => set({ minCategories: v })} />
            </Field>
            <Field label="Items priced under ₹5,000 at least">
              <Num value={r.minCheap} onChange={(v) => set({ minCheap: v })} />
            </Field>
            <Field label="One item may be at most">
              <Num value={r.maxShare} scale={100} suffix="% of the bill" onChange={(v) => set({ maxShare: v })} />
            </Field>
          </div>
        )}

        {r.kind === "product_units" && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Num value={r.amount} prefix="₹" onChange={(v) => set({ amount: v })} /> for every unit sold of the listed products
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={r.freeNotDiscount} onChange={(e) => set({ freeNotDiscount: e.target.checked })} />
              It is an offer with a free item (like Buy 2 Get 1): the free item is not counted as staff discount
            </label>
            <p className="text-xs text-black/50">Add the products under “Products for incentives” after saving.</p>
          </>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button className={primary} disabled={busy || !r.from} onClick={() => onSave(r)}>
          {busy ? "Saving…" : isNew ? "Add incentive" : "Save change"}
        </button>
        <button className={ghost} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {!r.from && <span className="self-center text-xs text-red-700">Choose the date.</span>}
        {r.from && r.from < today && !isNew && <span className="self-center text-xs text-amber-700">A past date changes the figures already shown for those days.</span>}
      </div>
    </div>
  );
}
