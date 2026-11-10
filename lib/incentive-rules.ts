// Incentive schemes that can be added, changed (from a date) and stopped (from a date).
// Shared by server and client code (no server-only imports here).
//
// Monthly incentives (store pool, achievement, ABV, product value) follow the version in force on
// the last day of the month. Per-bill and per-item incentives follow the version in force on the
// day of the bill.

import type { IncentiveGroup } from "@/lib/performance-rules";

export const ELIGIBLE_GROUPS: IncentiveGroup[] = ["sm", "asm", "sales", "cashier_cre", "backend", "vm", "housekeeping"];

type Base = {
  id: string;
  name: string;
  /** Who can earn it. */
  groups: IncentiveGroup[];
  /** First and last day in force (YYYY-MM-DD). Empty = no limit. */
  from: string | null;
  to: string | null;
};

export type StorePoolRule = Base & {
  kind: "store_pool";
  /** Store achievement (1 = 100%) → pool as a share of the store's sales. */
  slabs: { from: number; rate: number }[];
  /** Share of the pool for each group. The Sales Team splits theirs by sales; the others equally. */
  split: Partial<Record<IncentiveGroup, number>>;
};
export type AchievementRule = Base & { kind: "achievement"; slabs: { from: number; amount: number }[] };
export type AbvRule = Base & { kind: "abv"; slabs: { from: number; abv: number; amount: number }[] };
export type BillValueRule = Base & { kind: "bill_value"; minBill: number; amount: number };
export type WowRule = Base & {
  kind: "wow";
  minBill: number;
  minItems: number;
  minCategories: number;
  /** Items priced below ₹5,000. */
  minCheap: number;
  /** Biggest single item, as a share of the bill (0.6 = 60%). */
  maxShare: number;
  amount: number;
};
export type ProductUnitsRule = Base & {
  kind: "product_units";
  /** Product list key (Settings → products). */
  list: string;
  amount: number;
  /** The free item of the offer is not counted as a staff discount. */
  freeNotDiscount: boolean;
};
export type ProductValueRule = Base & { kind: "product_value"; list: string; slabs: { from: number; amount: number }[] };
/** Financial year (April–March): own sales against the year's targets (the monthly targets added up). */
export type YearlyAchievementRule = Base & { kind: "yearly_achievement"; slabs: { from: number; amount: number }[] };

export type IncentiveRule = StorePoolRule | AchievementRule | AbvRule | BillValueRule | WowRule | ProductUnitsRule | ProductValueRule | YearlyAchievementRule;
export type RuleKind = IncentiveRule["kind"];

/** How often an incentive is earned. */
export type RulePeriod = "daily" | "monthly" | "yearly";
export const RULE_PERIOD: Record<RuleKind, RulePeriod> = {
  bill_value: "daily",
  wow: "daily",
  product_units: "daily",
  store_pool: "monthly",
  achievement: "monthly",
  abv: "monthly",
  product_value: "monthly",
  yearly_achievement: "yearly",
};
export const PERIOD_LABEL: Record<RulePeriod, { title: string; help: string }> = {
  daily: { title: "Daily", help: "Earned bill by bill, every day (paid with the month)." },
  monthly: { title: "Monthly", help: "Worked out on the month's totals." },
  yearly: { title: "Yearly", help: "Worked out on the financial year (April–March), paid after March." },
};

/** Financial year of a date: April–March. */
export function financialYear(date: string) {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `${start}–${String(start + 1).slice(2)}` };
}

export const KIND_LABEL: Record<RuleKind, string> = {
  store_pool: "Store incentive pool",
  achievement: "Target achievement bonus",
  abv: "ABV booster",
  bill_value: "Per bill above an amount",
  wow: "WOW bill",
  product_units: "Per item of listed products",
  product_value: "Value of listed products (monthly slabs)",
  yearly_achievement: "Yearly target achievement",
};

export const KIND_HELP: Record<RuleKind, string> = {
  store_pool: "When the store reaches its target, a share of the store's sales is shared among the groups.",
  achievement: "A fixed amount for reaching a % of the person's own monthly target.",
  abv: "A fixed amount for reaching both a % of target and an average bill value.",
  bill_value: "A fixed amount for every bill at or above a bill value (returned bills do not count).",
  wow: "A fixed amount for every bill that meets all the WOW rules.",
  product_units: "A fixed amount for every unit sold of the products on its list (returns are taken off).",
  product_value: "A monthly amount by the value sold of the products on its list.",
  yearly_achievement: "A fixed amount for reaching a % of the person's target for the financial year (April–March), paid after March.",
};

const ALL = ELIGIBLE_GROUPS;

export const DEFAULT_RULES: IncentiveRule[] = [
  {
    id: "pool",
    kind: "store_pool",
    name: "Store performance incentive",
    groups: ALL,
    from: null,
    to: null,
    slabs: [
      { from: 0.9, rate: 0.01 },
      { from: 1.0, rate: 0.015 },
      { from: 1.1, rate: 0.02 },
      { from: 1.2, rate: 0.025 },
      { from: 1.3, rate: 0.03 },
    ],
    split: { sm: 0.15, asm: 0.1, sales: 0.45, cashier_cre: 0.075, backend: 0.15, vm: 0.05, housekeeping: 0.025 },
  },
  {
    id: "individual",
    kind: "achievement",
    name: "Individual achievement bonus",
    groups: ["sales", "asm"],
    from: null,
    to: null,
    slabs: [
      { from: 0.9, amount: 500 },
      { from: 1.0, amount: 1000 },
      { from: 1.1, amount: 1500 },
      { from: 1.2, amount: 2000 },
      { from: 1.3, amount: 2500 },
    ],
  },
  {
    id: "abv",
    kind: "abv",
    name: "ABV booster",
    groups: ["sales", "cashier_cre"],
    from: null,
    to: null,
    slabs: [
      { from: 0.9, abv: 1950, amount: 1000 },
      { from: 1.0, abv: 2150, amount: 1500 },
      { from: 1.1, abv: 2350, amount: 2000 },
      { from: 1.2, abv: 2550, amount: 2500 },
    ],
  },
  { id: "high_value", kind: "bill_value", name: "High value bill", groups: ALL, from: null, to: null, minBill: 50_000, amount: 500 },
  {
    id: "wow",
    kind: "wow",
    name: "WOW bill",
    groups: ALL,
    from: null,
    to: null,
    minBill: 10_000,
    minItems: 4,
    minCategories: 3,
    minCheap: 3,
    maxShare: 0.6,
    amount: 250,
  },
  { id: "b2g1", kind: "product_units", name: "Buy 2 Get 1", groups: ALL, from: null, to: null, list: "b2g1", amount: 10, freeNotDiscount: true },
  {
    id: "slow_moving",
    kind: "product_value",
    name: "Slow-moving products",
    groups: ALL,
    from: null,
    to: null,
    list: "slow_moving",
    slabs: [
      { from: 1000, amount: 100 },
      { from: 5001, amount: 200 },
      { from: 10001, amount: 300 },
    ],
  },
];

export const inForce = (r: Pick<IncentiveRule, "from" | "to">, date: string) => (!r.from || r.from <= date) && (!r.to || r.to >= date);

/** Rules in force on a day. */
export const rulesOn = (rules: IncentiveRule[], date: string) => rules.filter((r) => inForce(r, date));

export function ruleStatus(r: IncentiveRule, today: string): "active" | "scheduled" | "ended" {
  if (r.to && r.to < today) return "ended";
  if (r.from && r.from > today) return "scheduled";
  return "active";
}

/** Highest slab reached (slabs in any order). */
export function slabFor<T extends { from: number }>(slabs: T[], value: number): T | null {
  return [...slabs].sort((a, b) => b.from - a.from).find((s) => value >= s.from) ?? null;
}
/** Next slab above the current value. */
export function nextSlab<T extends { from: number }>(slabs: T[], value: number): T | null {
  return [...slabs].sort((a, b) => a.from - b.from).find((s) => value < s.from) ?? null;
}

export function abvAmount(rule: AbvRule, achievement: number | null, abv: number) {
  if (achievement === null) return 0;
  return [...rule.slabs].sort((a, b) => b.amount - a.amount).find((s) => achievement >= s.from && abv >= s.abv)?.amount ?? 0;
}

const rs = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const pc = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** One line describing the amounts of a rule. */
export function ruleSummary(r: IncentiveRule): string {
  switch (r.kind) {
    case "store_pool":
      return [...r.slabs].sort((a, b) => a.from - b.from).map((s) => `${pc(s.from)}+ → ${pc(s.rate)} of sales`).join(" · ");
    case "achievement":
      return [...r.slabs].sort((a, b) => a.from - b.from).map((s) => `${pc(s.from)}+ → ${rs(s.amount)}`).join(" · ");
    case "abv":
      return [...r.slabs].sort((a, b) => a.from - b.from).map((s) => `${pc(s.from)} & ABV ${rs(s.abv)} → ${rs(s.amount)}`).join(" · ");
    case "bill_value":
      return `${rs(r.amount)} per bill of ${rs(r.minBill)} or more`;
    case "wow":
      return `${rs(r.amount)} per bill: ${rs(r.minBill)}+, ${r.minItems}+ items, ${r.minCategories}+ categories, ${r.minCheap}+ items under ₹5,000, no item over ${pc(r.maxShare)}`;
    case "product_units":
      return `${rs(r.amount)} per unit of the listed products`;
    case "product_value":
      return [...r.slabs].sort((a, b) => a.from - b.from).map((s) => `${rs(s.from)}+ → ${rs(s.amount)}`).join(" · ");
    case "yearly_achievement":
      return [...r.slabs].sort((a, b) => a.from - b.from).map((s) => `${pc(s.from)}+ of the year's target → ${rs(s.amount)}`).join(" · ");
  }
}

/** Basic checks before saving (returns a problem, or null when fine). */
export function ruleProblem(r: IncentiveRule): string | null {
  if (!r.name?.trim()) return "Give the incentive a name.";
  if (r.from && r.to && r.to < r.from) return "The end date is before the start date.";
  const money = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  switch (r.kind) {
    case "store_pool": {
      if (!r.slabs.length || r.slabs.some((s) => !money(s.from) || !money(s.rate) || s.rate > 0.5)) return "Check the pool levels.";
      const total = Object.values(r.split).reduce((s: number, v) => s + (v ?? 0), 0);
      if (total > 1.0001) return "The group shares add up to more than 100%.";
      return null;
    }
    case "achievement":
    case "product_value":
    case "yearly_achievement":
      return r.slabs.length && r.slabs.every((s) => money(s.from) && money(s.amount)) ? null : "Check the levels and amounts.";
    case "abv":
      return r.slabs.length && r.slabs.every((s) => money(s.from) && money(s.abv) && money(s.amount)) ? null : "Check the levels and amounts.";
    case "bill_value":
      return money(r.minBill) && money(r.amount) ? null : "Check the bill value and amount.";
    case "wow":
      return [r.minBill, r.minItems, r.minCategories, r.minCheap, r.maxShare, r.amount].every(money) && r.maxShare <= 1 ? null : "Check the WOW rules.";
    case "product_units":
      return money(r.amount) ? null : "Check the amount.";
  }
}
