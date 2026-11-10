// Groups, settings and helpers for the sales performance dashboard.
// The incentive schemes themselves are in lib/incentive-rules.ts.
// Shared by server and client code (no server-only imports here).

import type { Role } from "@/lib/roles";

export type PtPerson = { name: string; group?: IncentiveGroup };

export type PerformanceSettings = {
  /** A bill is flagged when its discount is more than this % of the bill (before discount). */
  highDiscountPct: number;
  /** Monthly target of each store (₹, without tax). A month can be changed separately. */
  storeTargets: Record<string, number>;
  /** Stores left out (e.g. not opened yet). */
  excludedStores: string[];
  /** Duties needed in a month (the 26-duty rule). */
  dutiesRequired: number;
  /** Zoho salesperson names → staff User ID (or a PT code for daily-wages staff). */
  salespersonLinks: Record<string, string>;
  /** Daily-wages staff (no employee code): PT1, PT2 … */
  ptPeople: Record<string, PtPerson>;
  /** Own names for the groups (e.g. "CSA" instead of "Sales Team (CSA)"), also the names of added groups. */
  groupLabels: Partial<Record<IncentiveGroup, string>>;
  /** Groups added in Settings (keys; their names are in groupLabels). */
  customGroups: string[];
  /** Store whose pool a person shares when their own store is the Corporate Office (User ID → store). */
  incentiveStores: Record<string, string>;
  /** Expected net sales for every ₹1 of salary (0 = not set). Management view only. */
  salesPerSalary: number;
  lastSyncAt?: string | null;
  returnsError?: string | null;
};

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  highDiscountPct: 5,
  storeTargets: { VATAKARA: 5_000_000, PERAMBRA: 4_000_000 },
  excludedStores: ["PERINTHALMANNA"],
  dutiesRequired: 26,
  salespersonLinks: {},
  ptPeople: {},
  groupLabels: {},
  customGroups: [],
  incentiveStores: {},
  salesPerSalary: 0,
};

// ------------------------------------------------------------------
// Groups (who shares which part of the store pool, who can earn what)
// ------------------------------------------------------------------

export const INCENTIVE_GROUPS = [
  { key: "sm", label: "Store Manager" },
  { key: "asm", label: "Assistant Store Manager" },
  { key: "sales", label: "Sales Team (CSA)" },
  { key: "cashier_cre", label: "Cashier / CRE" },
  { key: "backend", label: "Backend Staff" },
  { key: "vm", label: "Visual Merchandiser" },
  { key: "housekeeping", label: "Housekeeping" },
  { key: "none", label: "Not in incentive" },
] as const;
export type BuiltInGroup = (typeof INCENTIVE_GROUPS)[number]["key"];
/** A built-in group key or one added in Settings. */
export type IncentiveGroup = string;
export const GROUP_LABEL = Object.fromEntries(INCENTIVE_GROUPS.map((g) => [g.key, g.label])) as Record<string, string>;
export const isBuiltInGroup = (key: string) => INCENTIVE_GROUPS.some((g) => g.key === key);

/** Group name, using the names set in Settings. */
export function groupName(key: IncentiveGroup, labels?: Partial<Record<IncentiveGroup, string>>) {
  return labels?.[key]?.trim() || GROUP_LABEL[key] || key;
}

export function isGroup(v: unknown): v is IncentiveGroup {
  return typeof v === "string" && /^[a-z][a-z0-9_]{0,40}$/.test(v);
}

/** Every group in order: built-in ones, added ones, then "Not in incentive". */
export function groupList(s: Pick<PerformanceSettings, "groupLabels" | "customGroups">) {
  const out: { key: string; label: string; custom: boolean }[] = INCENTIVE_GROUPS.filter((g) => g.key !== "none").map((g) => ({ key: g.key, label: groupName(g.key, s.groupLabels), custom: false }));
  for (const k of s.customGroups ?? []) out.push({ key: k, label: groupName(k, s.groupLabels), custom: true });
  out.push({ key: "none", label: groupName("none", s.groupLabels), custom: false });
  return out;
}

/** Group used when none is chosen in Settings. */
export function defaultGroup(role: Role, roleLabel: string): IncentiveGroup {
  const label = roleLabel.toLowerCase();
  if (/assistant\s*(store)?\s*manager|\basm\b/.test(label)) return "asm";
  if (/visual/.test(label)) return "vm";
  if (/house\s*keep/.test(label)) return "housekeeping";
  if (/cashier/.test(label)) return "cashier_cre";
  if (/back\s*end|backend/.test(label)) return "backend";
  if (/data\s*entry|clerk|hr\b|accounts?/.test(label)) return "none";
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

/** Attendance: unauthorised absences (26-duty rule) → share of incentive paid. */
export function attendanceShare(absences: number) {
  if (absences <= 0) return 1;
  if (absences === 1) return 0.75;
  if (absences === 2) return 0.5;
  return 0;
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

export const isPtCode = (v: string) => /^PT\d+$/.test(v);

export const rupees = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
