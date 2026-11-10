// Incentive rules from the Seven Years "Monthly Sales & Performance Incentive Policy" and
// "Spot Incentives". Shared by server and client code (no server-only imports here).

import type { Role } from "@/lib/roles";

export type PerformanceSettings = {
  /** A bill is flagged when its discount is more than this % of the bill (before discount). */
  highDiscountPct: number;
  /** Monthly target of each store (₹, without tax). A month can be changed separately. */
  storeTargets: Record<string, number>;
  /** Stores left out (e.g. not opened yet). */
  excludedStores: string[];
  /** Duties needed in a month (the 26-duty rule). */
  dutiesRequired: number;
  /** Zoho salesperson names without a User ID → staff User ID. */
  salespersonLinks: Record<string, string>;
  lastSyncAt?: string | null;
  returnsError?: string | null;
};

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  highDiscountPct: 5,
  storeTargets: { VATAKARA: 5_000_000, PERAMBRA: 4_000_000 },
  excludedStores: ["PERINTHALMANNA"],
  dutiesRequired: 26,
  salespersonLinks: {},
};

// ------------------------------------------------------------------
// Groups (who shares which part of the store pool)
// ------------------------------------------------------------------

export const INCENTIVE_GROUPS = [
  { key: "sm", label: "Store Manager", short: "SM" },
  { key: "asm", label: "Assistant Store Manager", short: "ASM" },
  { key: "sales", label: "Sales Team (CSA)", short: "Sales" },
  { key: "cashier_cre", label: "Cashier / CRE", short: "Cashier/CRE" },
  { key: "backend", label: "Backend Staff", short: "Backend" },
  { key: "vm", label: "Visual Merchandiser", short: "VM" },
  { key: "housekeeping", label: "Housekeeping", short: "Housekeeping" },
  { key: "none", label: "Not in incentive", short: "—" },
] as const;
export type IncentiveGroup = (typeof INCENTIVE_GROUPS)[number]["key"];
export const GROUP_LABEL = Object.fromEntries(INCENTIVE_GROUPS.map((g) => [g.key, g.label])) as Record<IncentiveGroup, string>;

export function isGroup(v: unknown): v is IncentiveGroup {
  return INCENTIVE_GROUPS.some((g) => g.key === v);
}

/** Group used when none is chosen in Settings. */
export function defaultGroup(role: Role, roleLabel: string): IncentiveGroup {
  const label = roleLabel.toLowerCase();
  if (/assistant\s*(store)?\s*manager|\basm\b/.test(label)) return "asm";
  if (/visual/.test(label)) return "vm";
  if (/house\s*keep/.test(label)) return "housekeeping";
  if (/cashier/.test(label)) return "cashier_cre";
  if (/back\s*end|backend/.test(label)) return "backend";
  switch (role) {
    case "store_manager":
      return "sm";
    case "csa":
    case "floor_incharge":
    case "staff":
      return "sales";
    case "cre":
      return "cashier_cre";
    case "technician":
      return "backend";
    default:
      return "none";
  }
}

/** Part of the store pool for each group (policy section 6). */
export const POOL_SPLIT: Record<Exclude<IncentiveGroup, "none" | "sm" | "asm">, number> & { managers: number } = {
  managers: 0.25,
  sales: 0.45,
  cashier_cre: 0.075,
  backend: 0.15,
  vm: 0.05,
  housekeeping: 0.025,
};
/** Inside the managers' 25%: Store Manager 60%, Assistant Store Manager 40%. */
export const MANAGER_SPLIT = { sm: 0.6, asm: 0.4 };

// ------------------------------------------------------------------
// Slabs
// ------------------------------------------------------------------

/** Store achievement → pool as a share of actual sales. Below 90% nothing. */
export const STORE_POOL_SLABS = [
  { from: 1.3, rate: 0.03 },
  { from: 1.2, rate: 0.025 },
  { from: 1.1, rate: 0.02 },
  { from: 1.0, rate: 0.015 },
  { from: 0.9, rate: 0.01 },
];

/** Individual achievement → bonus (CSA, and ASM when they carry a target). */
export const INDIVIDUAL_SLABS = [
  { from: 1.3, amount: 2500 },
  { from: 1.2, amount: 2000 },
  { from: 1.1, amount: 1500 },
  { from: 1.0, amount: 1000 },
  { from: 0.9, amount: 500 },
];

/** ABV booster: needs both the target achievement and the ABV of the row. */
export const ABV_SLABS = [
  { from: 1.2, abv: 2550, amount: 2500 },
  { from: 1.1, abv: 2350, amount: 2000 },
  { from: 1.0, abv: 2150, amount: 1500 },
  { from: 0.9, abv: 1950, amount: 1000 },
];

export const INDIVIDUAL_BONUS_GROUPS: IncentiveGroup[] = ["sales", "asm"];
export const ABV_GROUPS: IncentiveGroup[] = ["sales", "cashier_cre"];

/** Attendance: unauthorised absences (26-duty rule) → share of incentive paid. */
export function attendanceShare(absences: number) {
  if (absences <= 0) return 1;
  if (absences === 1) return 0.75;
  if (absences === 2) return 0.5;
  return 0;
}

// Spot incentives
export const SPOT = {
  highValueBill: 50_000,
  highValueReward: 500,
  wowBill: 10_000,
  wowMinUnits: 4,
  wowMinCategories: 3,
  wowMinUnder5k: 3,
  wowMaxShare: 0.6,
  wowReward: 250,
  b2g1PerUnit: 10,
};

export function slowMovingReward(value: number) {
  if (value > 10_000) return 300;
  if (value > 5_000) return 200;
  if (value >= 1_000) return 100;
  return 0;
}

export function storePoolRate(achievement: number) {
  return STORE_POOL_SLABS.find((s) => achievement >= s.from)?.rate ?? 0;
}

export function individualBonus(achievement: number) {
  return INDIVIDUAL_SLABS.find((s) => achievement >= s.from)?.amount ?? 0;
}

export function abvBonus(achievement: number | null, abv: number) {
  if (achievement === null) return 0;
  return ABV_SLABS.find((s) => achievement >= s.from && abv >= s.abv)?.amount ?? 0;
}

/** Next step up from where someone is now (for "₹X more to earn ₹Y"). */
export function nextIndividualSlab(achievement: number) {
  return [...INDIVIDUAL_SLABS].reverse().find((s) => achievement < s.from) ?? null;
}
export function nextStoreSlab(achievement: number) {
  return [...STORE_POOL_SLABS].reverse().find((s) => achievement < s.from) ?? null;
}

export const monthOf = (isoDate: string) => isoDate.slice(0, 7);

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}`, days: last };
}

export function isMonth(v: unknown): v is string {
  return typeof v === "string" && /^20\d\d-(0[1-9]|1[0-2])$/.test(v);
}

export const rupees = (n: number) =>
  "₹" + Math.round(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
