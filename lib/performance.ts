// Sales performance: targets, achievement, incentives earned and lost. Server only.
// Numbers come from the bills and returns copied from Zoho POS (lib/sales-sync.ts).
// The incentive schemes come from Settings (lib/incentive-rules.ts), each with its own dates.

import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";
import { asRole, ROLE_LABELS } from "@/lib/roles";
import { loadAccessConfig } from "@/lib/access-config";
import { attendanceCode } from "@/lib/attendance";
import { CORPORATE_OFFICE } from "@/lib/stores";
import { loadIncentiveRules, loadPerformanceSettings } from "@/lib/performance-settings";
import { attendanceShare, defaultGroup, isGroup, isPtCode, monthRange, type IncentiveGroup, type PerformanceSettings } from "@/lib/performance-rules";
import {
  abvAmount,
  inForce,
  nextSlab,
  rulesOn,
  slabFor,
  type AbvRule,
  type AchievementRule,
  type BillValueRule,
  type IncentiveRule,
  type ProductUnitsRule,
  type ProductValueRule,
  type RuleKind,
  type StorePoolRule,
  type WowRule,
  type YearlyAchievementRule,
  financialYear,
} from "@/lib/incentive-rules";

// ------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Supabase returns at most 1000 rows per call: page through. */
async function fetchAll<T extends Row>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, max = 50_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export type InvoiceRow = {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  store: string | null;
  salesperson: string | null;
  staff_user_id: string | null;
  gross: number;
  discount: number;
  net: number;
  total: number;
  quantity: number;
  line_count: number;
  category_count: number;
  units_under_5k: number;
  max_line_share: number;
};

export type ReturnRow = {
  creditnote_id: string;
  creditnote_number: string;
  return_date: string;
  store: string | null;
  staff_user_id: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  net: number;
};

type PromoRow = { id: number; kind: string; item_id: string | null; sku: string | null; name: string; from_date: string | null; to_date: string | null };

const INVOICE_COLS =
  "invoice_id, invoice_number, invoice_date, store, salesperson, staff_user_id, gross, discount, net, total, quantity, line_count, category_count, units_under_5k, max_line_share";

const n = (v: unknown) => Number(v) || 0;

function normInvoice(r: Row): InvoiceRow {
  return {
    invoice_id: String(r.invoice_id),
    invoice_number: String(r.invoice_number ?? ""),
    invoice_date: String(r.invoice_date),
    store: (r.store as string) ?? null,
    salesperson: (r.salesperson as string) ?? null,
    staff_user_id: (r.staff_user_id as string) ?? null,
    gross: n(r.gross),
    discount: n(r.discount),
    net: n(r.net),
    total: n(r.total),
    quantity: n(r.quantity),
    line_count: n(r.line_count),
    category_count: n(r.category_count),
    units_under_5k: n(r.units_under_5k),
    max_line_share: n(r.max_line_share),
  };
}

function normReturn(r: Row): ReturnRow {
  return {
    creditnote_id: String(r.creditnote_id),
    creditnote_number: String(r.creditnote_number ?? ""),
    return_date: String(r.return_date),
    store: (r.store as string) ?? null,
    staff_user_id: (r.staff_user_id as string) ?? null,
    invoice_id: (r.invoice_id as string) ?? null,
    invoice_number: (r.invoice_number as string) ?? null,
    net: n(r.net),
  };
}

const overlaps = (r: Pick<IncentiveRule, "from" | "to">, from: string, to: string) => (!r.from || r.from <= to) && (!r.to || r.to >= from);

async function loadMonth(month: string, lists: string[]) {
  const { from, to } = monthRange(month);
  const [invoices, returns, promos] = await Promise.all([
    fetchAll<Row>((a, b) =>
      supabaseAdmin.from("sales_invoices").select(INVOICE_COLS).gte("invoice_date", from).lte("invoice_date", to).order("invoice_id").range(a, b)
    ),
    fetchAll<Row>((a, b) =>
      supabaseAdmin
        .from("sales_returns")
        .select("creditnote_id, creditnote_number, return_date, store, staff_user_id, invoice_id, invoice_number, net")
        .gte("return_date", from)
        .lte("return_date", to)
        .order("creditnote_id")
        .range(a, b)
    ),
    lists.length
      ? supabaseAdmin.from("promo_products").select("id, kind, item_id, sku, name, from_date, to_date").in("kind", lists).limit(10000)
      : Promise.resolve({ data: [] as PromoRow[] }),
  ]);
  return {
    invoices: invoices.map(normInvoice),
    returns: returns.map(normReturn),
    promos: ((promos.data ?? []) as PromoRow[]).filter((p) => (!p.from_date || p.from_date <= to) && (!p.to_date || p.to_date >= from)),
  };
}

/** Lines of listed products sold and returned in the month. */
async function loadPromoLines(month: string, promos: PromoRow[], userId?: string) {
  const { from, to } = monthRange(month);
  const ids = [...new Set(promos.map((p) => p.item_id).filter(Boolean) as string[])];
  const skus = [...new Set(promos.filter((p) => !p.item_id && p.sku).map((p) => p.sku as string))];
  const sold: Row[] = [];
  const back: Row[] = [];
  const chunks = <T,>(list: T[]) => Array.from({ length: Math.ceil(list.length / 150) }, (_, i) => list.slice(i * 150, i * 150 + 150));
  for (const [col, values] of [["item_id", ids], ["sku", skus]] as const) {
    for (const part of chunks(values)) {
      sold.push(
        ...(await fetchAll<Row>((a, b) => {
          let q = supabaseAdmin
            .from("sales_invoice_lines")
            .select("invoice_id, invoice_date, staff_user_id, store, item_id, sku, quantity, discount, net")
            .in(col, part)
            .gte("invoice_date", from)
            .lte("invoice_date", to);
          if (userId) q = q.eq("staff_user_id", userId);
          return q.order("line_item_id").range(a, b);
        }))
      );
      back.push(
        ...(await fetchAll<Row>((a, b) => {
          let q = supabaseAdmin
            .from("sales_return_lines")
            .select("return_date, staff_user_id, store, item_id, sku, quantity, net")
            .in(col, part)
            .gte("return_date", from)
            .lte("return_date", to);
          if (userId) q = q.eq("staff_user_id", userId);
          return q.order("line_item_id").range(a, b);
        }))
      );
    }
  }
  return { sold, back };
}

/** Product lists a line belongs to on that day. */
function listsOf(promos: PromoRow[], line: Row, date: string) {
  const lists = new Set<string>();
  for (const p of promos) {
    const match = (p.item_id && p.item_id === line.item_id) || (!p.item_id && p.sku && p.sku === line.sku);
    if (!match) continue;
    if (p.from_date && date < p.from_date) continue;
    if (p.to_date && date > p.to_date) continue;
    lists.add(p.kind);
  }
  return lists;
}

/** Discount on the free items of offers (e.g. Buy 2 Get 1), per bill: not a staff discount. */
function offerDiscounts(rules: IncentiveRule[], promos: PromoRow[], sold: Row[]) {
  const out = new Map<string, number>();
  const offers = rules.filter((r): r is ProductUnitsRule => r.kind === "product_units" && r.freeNotDiscount);
  for (const l of sold) {
    const date = String(l.invoice_date);
    const lists = listsOf(promos, l, date);
    if (!offers.some((r) => inForce(r, date) && lists.has(r.list))) continue;
    const id = String(l.invoice_id);
    out.set(id, (out.get(id) ?? 0) + n(l.discount));
  }
  return out;
}

// ------------------------------------------------------------------
// Staff, targets, attendance
// ------------------------------------------------------------------

export type StaffRow = {
  id: string;
  userId: string;
  name: string;
  roleLabel: string;
  role: string;
  store: string | null;
  group: IncentiveGroup;
  groupChosen: boolean;
};

export async function loadStaffForPerformance(): Promise<StaffRow[]> {
  const [{ data }, config] = await Promise.all([
    supabaseAdmin.from("staff_users").select("id, user_id, full_name, role, store_name, custom_role_id, incentive_group, is_active").eq("is_active", true),
    loadAccessConfig(),
  ]);
  return ((data ?? []) as Row[]).map((s) => {
    const role = asRole(s.role);
    const custom = s.custom_role_id ? config.custom.find((c) => c.id === s.custom_role_id) : undefined;
    const roleLabel = custom?.name ?? ROLE_LABELS[role];
    const chosen = isGroup(s.incentive_group) ? (s.incentive_group as IncentiveGroup) : null;
    return {
      id: String(s.id),
      userId: attendanceCode(s.user_id),
      name: String(s.full_name ?? ""),
      roleLabel,
      role,
      store: s.store_name ? String(s.store_name).toUpperCase() : null,
      group: chosen ?? defaultGroup(role, roleLabel),
      groupChosen: Boolean(chosen),
    };
  });
}

export async function loadTargets(month: string) {
  const [{ data: staff }, { data: stores }] = await Promise.all([
    supabaseAdmin.from("staff_sales_targets").select("user_id, sales_target, abv_target").eq("month", month),
    supabaseAdmin.from("store_sales_targets").select("store, target").eq("month", month),
  ]);
  return {
    staff: new Map(((staff ?? []) as Row[]).map((t) => [attendanceCode(t.user_id), { sales: n(t.sales_target), abv: t.abv_target === null ? null : n(t.abv_target) }])),
    stores: new Map(((stores ?? []) as Row[]).map((t) => [String(t.store).toUpperCase(), n(t.target)])),
  };
}

export type Attendance = { duties: number; required: number; remaining: number; absences: number; share: number; found: boolean; noData: number };

async function loadDuties(month: string) {
  const { from, to } = monthRange(month);
  const rows = await fetchAll<Row>((a, b) =>
    supabaseAdmin
      .from("attendance_punches")
      .select("emp_code, punch_time")
      .gte("punch_time", `${from}T00:00:00+05:30`)
      .lte("punch_time", `${to}T23:59:59+05:30`)
      .order("id")
      .range(a, b)
  );
  const days = new Map<string, Set<string>>();
  const withData = new Set<string>();
  for (const r of rows) {
    const code = attendanceCode(r.emp_code);
    const day = todayISO(new Date(String(r.punch_time)));
    if (!days.has(code)) days.set(code, new Set());
    days.get(code)!.add(day);
    withData.add(day);
  }
  return { days, withData };
}

function attendanceFor(month: string, days: Set<string> | undefined, withData: Set<string>, required: number): Attendance {
  const { days: inMonth } = monthRange(month);
  const today = todayISO();
  const duties = days?.size ?? 0;
  let remaining = 0;
  let past = 0;
  if (today.slice(0, 7) === month) {
    const day = Number(today.slice(8, 10));
    remaining = inMonth - day + (days?.has(today) ? 0 : 1);
    past = day - 1;
  } else if (today.slice(0, 7) < month) {
    remaining = inMonth;
  } else {
    past = inMonth;
  }
  // Past days when the punching machine sent nothing at all (no data yet, machine off):
  // nobody is marked absent for those.
  let noData = 0;
  for (let d = 1; d <= past; d++) {
    const iso = `${month}-${String(d).padStart(2, "0")}`;
    if (!withData.has(iso) && !days?.has(iso)) noData++;
  }
  // Absences that can no longer be made up (the 26-duty rule).
  const absences = Math.max(0, required - duties - noData - remaining);
  return { duties, required, remaining, absences, share: attendanceShare(absences), found: duties > 0, noData };
}

// ------------------------------------------------------------------
// Bill rules
// ------------------------------------------------------------------

export function isWowBill(b: InvoiceRow, r: WowRule) {
  return b.total >= r.minBill && b.quantity >= r.minItems && b.category_count >= r.minCategories && b.units_under_5k >= r.minCheap && b.max_line_share <= r.maxShare;
}

/** Why a bill is not a WOW bill (empty when it is). */
export function wowGaps(b: InvoiceRow, r: WowRule) {
  const gaps: string[] = [];
  if (b.total < r.minBill) gaps.push(`bill below ₹${r.minBill.toLocaleString("en-IN")}`);
  if (b.quantity < r.minItems) gaps.push(`${r.minItems - b.quantity} more item(s)`);
  if (b.category_count < r.minCategories) {
    const k = r.minCategories - b.category_count;
    gaps.push(`${k} more categor${k === 1 ? "y" : "ies"}`);
  }
  if (b.units_under_5k < r.minCheap) gaps.push(`${r.minCheap - b.units_under_5k} more item(s) under ₹5,000`);
  if (b.max_line_share > r.maxShare) gaps.push(`one item is ${Math.round(b.max_line_share * 100)}% of the bill (max ${Math.round(r.maxShare * 100)}%)`);
  return gaps;
}

const billQualifies = (b: InvoiceRow, r: BillValueRule | WowRule) => (r.kind === "bill_value" ? b.total >= r.minBill : isWowBill(b, r));

export const discountShare = (b: { gross: number; discount: number }) => (b.gross > 0 ? b.discount / b.gross : 0);

const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** "WOW bill (from 15 Nov)" when a version starts or ends inside the month. */
function versionName(r: IncentiveRule, from: string, to: string) {
  const bits: string[] = [];
  if (r.from && r.from > from && r.from <= to) bits.push(`from ${shortDate(r.from)}`);
  if (r.to && r.to >= from && r.to < to) bits.push(`until ${shortDate(r.to)}`);
  return bits.length ? `${r.name} (${bits.join(", ")})` : r.name;
}

// ------------------------------------------------------------------
// Report
// ------------------------------------------------------------------

export type IncentiveLine = { ruleId: string; name: string; kind: RuleKind; note: string; amount: number };

export type PersonReport = {
  staffId: string | null;
  userId: string;
  name: string;
  roleLabel: string;
  group: IncentiveGroup;
  store: string | null;
  isPt: boolean;
  bills: number;
  units: number;
  gross: number;
  discount: number;
  invoiceNet: number;
  returns: number;
  returnCount: number;
  net: number;
  abv: number;
  discountPct: number;
  flaggedBills: number;
  target: number | null;
  abvTarget: number | null;
  achievement: number | null;
  storeShare: number;
  /** Target and ABV bonuses. */
  bonus: number;
  /** Per-bill and product incentives. */
  spotTotal: number;
  /** Every incentive (other than the store pool) this person can earn this month. */
  lines: IncentiveLine[];
  lostToReturns: number;
  lostNotes: string[];
  attendance: Attendance;
  earnedBeforeAttendance: number;
  attendanceCut: number;
  total: number;
};

export type StoreReport = {
  month: string;
  store: string;
  target: number;
  gross: number;
  discount: number;
  invoiceNet: number;
  returns: number;
  net: number;
  bills: number;
  achievement: number;
  poolName: string | null;
  poolRate: number;
  pool: number;
  nextSlab: { from: number; rate: number; needed: number } | null;
  othersNet: number;
  othersBills: number;
  othersGross: number;
  othersDiscount: number;
  othersFlagged: number;
  /** Items sold (carry bags left out). */
  units: number;
  returnCount: number;
  /** Per-bill incentive counts at store level (e.g. WOW bills). */
  spotCounts: { name: string; count: number }[];
  people: PersonReport[];
  flagged: InvoiceRow[];
  daysInMonth: number;
  daysGone: number;
};

export type MonthReport = {
  month: string;
  settings: PerformanceSettings;
  /** Incentives in force at some point in the month. */
  rules: IncentiveRule[];
  stores: StoreReport[];
  /** Zoho salesperson names whose User ID no active staff member has. */
  unlinked: { name: string; net: number; bills: number }[];
  lastBillDate: string | null;
};

type Acc = {
  bills: number;
  units: number;
  gross: number;
  discount: number;
  invoiceNet: number;
  returns: number;
  returnCount: number;
  flaggedBills: number;
  stores: Map<string, number>;
  /** per rule: count / units / value and amount */
  per: Map<string, { count: number; amount: number; units: number; value: number; lost: number; lostCount: number }>;
  lostToReturns: number;
};

let cache: { key: string; at: number; value: MonthReport } | null = null;

export async function monthReport(month: string, fresh = false): Promise<MonthReport> {
  if (!fresh && cache && cache.key === month && Date.now() - cache.at < 60_000) return cache.value;

  const { from: mFrom, to: mTo, days: daysInMonth } = monthRange(month);
  const [settings, allRules] = await Promise.all([loadPerformanceSettings(), loadIncentiveRules()]);
  const rules = allRules.filter((r) => overlaps(r, mFrom, mTo));
  const monthly = rulesOn(rules, mTo);
  const billRules = rules.filter((r): r is BillValueRule | WowRule => r.kind === "bill_value" || r.kind === "wow");
  const unitRules = rules.filter((r): r is ProductUnitsRule => r.kind === "product_units");
  const valueRules = monthly.filter((r): r is ProductValueRule => r.kind === "product_value");
  const achRules = monthly.filter((r): r is AchievementRule => r.kind === "achievement");
  const abvRules = monthly.filter((r): r is AbvRule => r.kind === "abv");
  const poolRule = monthly.find((r): r is StorePoolRule => r.kind === "store_pool") ?? null;
  const lists = [...new Set([...unitRules.map((r) => r.list), ...valueRules.map((r) => r.list)])];

  const [{ invoices: rawInvoices, returns, promos }, staff, targets, duties] = await Promise.all([
    loadMonth(month, lists),
    loadStaffForPerformance(),
    loadTargets(month),
    loadDuties(month),
  ]);
  const promoLines = promos.length ? await loadPromoLines(month, promos) : { sold: [], back: [] };

  // The free item of an offer (e.g. Buy 2 Get 1) is a promotion, not a discount given by staff.
  const offerDisc = offerDiscounts(rules, promos, promoLines.sold);
  const invoices = rawInvoices.map((b) => (offerDisc.has(b.invoice_id) ? { ...b, discount: Math.max(0, b.discount - (offerDisc.get(b.invoice_id) ?? 0)) } : b));

  const excluded = new Set(settings.excludedStores.map((s) => s.toUpperCase()));
  const today = todayISO();
  const daysGone = today.slice(0, 7) > month ? daysInMonth : today.slice(0, 7) < month ? 0 : Number(today.slice(8, 10));
  const threshold = settings.highDiscountPct / 100;

  const staffById = new Map(staff.map((s) => [s.userId, s]));
  // Corporate Office staff can be given a store whose pool they share.
  const storeOf = (s: StaffRow) => settings.incentiveStores[s.userId]?.toUpperCase() || s.store;
  const notInIncentive = new Set(staff.filter((s) => s.group === "none").map((s) => s.userId));
  const groupOf = (id: string): IncentiveGroup => staffById.get(id)?.group ?? (isPtCode(id) ? settings.ptPeople[id]?.group ?? "sales" : "sales");

  // Bills returned (any time up to now) do not earn per-bill incentives.
  const lowest = Math.min(Infinity, ...billRules.map((r) => r.minBill));
  const candidates = invoices.filter((b) => b.total >= lowest).map((b) => b.invoice_id);
  const returnedBills = new Set<string>();
  for (let i = 0; i < candidates.length; i += 200) {
    const { data } = await supabaseAdmin.from("sales_returns").select("invoice_id").in("invoice_id", candidates.slice(i, i + 200));
    for (const r of data ?? []) if (r.invoice_id) returnedBills.add(String(r.invoice_id));
  }

  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    if (!acc.has(id)) acc.set(id, { bills: 0, units: 0, gross: 0, discount: 0, invoiceNet: 0, returns: 0, returnCount: 0, flaggedBills: 0, stores: new Map(), per: new Map(), lostToReturns: 0 });
    return acc.get(id)!;
  };
  const per = (a: Acc, ruleId: string) => {
    if (!a.per.has(ruleId)) a.per.set(ruleId, { count: 0, amount: 0, units: 0, value: 0, lost: 0, lostCount: 0 });
    return a.per.get(ruleId)!;
  };

  const unlinked = new Map<string, { name: string; net: number; bills: number }>();
  const spName = new Map<string, string>();

  for (const b of invoices) {
    const id = b.staff_user_id;
    if (id && !staffById.has(id) && !isPtCode(id) && b.salesperson) {
      // A User ID on the bill that no active staff member has (e.g. an old code).
      const u = unlinked.get(b.salesperson) ?? { name: b.salesperson, net: 0, bills: 0 };
      u.net += b.net;
      u.bills++;
      unlinked.set(b.salesperson, u);
    }
    if (!id) continue;
    if (b.salesperson && !spName.has(id)) spName.set(id, b.salesperson);
    const a = get(id);
    a.bills++;
    a.units += b.quantity;
    a.gross += b.gross;
    a.discount += b.discount;
    a.invoiceNet += b.net;
    if (b.store) a.stores.set(b.store, (a.stores.get(b.store) ?? 0) + b.net);
    if (discountShare(b) > threshold) a.flaggedBills++;
    const g = groupOf(id);
    const returned = returnedBills.has(b.invoice_id);
    for (const r of billRules) {
      if (!inForce(r, b.invoice_date) || !r.groups.includes(g) || !billQualifies(b, r)) continue;
      const p = per(a, r.id);
      if (returned) {
        p.lost += r.amount;
        p.lostCount++;
        a.lostToReturns += r.amount;
      } else {
        p.count++;
        p.amount += r.amount;
      }
    }
  }
  for (const r of returns) {
    if (!r.staff_user_id) continue;
    const a = get(r.staff_user_id);
    a.returns += r.net;
    a.returnCount++;
  }
  // Listed products
  for (const l of promoLines.sold) {
    const id = l.staff_user_id ? String(l.staff_user_id) : null;
    if (!id) continue;
    const date = String(l.invoice_date);
    const inLists = listsOf(promos, l, date);
    const g = groupOf(id);
    for (const r of unitRules) if (inForce(r, date) && r.groups.includes(g) && inLists.has(r.list)) per(get(id), r.id).units += n(l.quantity);
    for (const r of valueRules) if (r.groups.includes(g) && inLists.has(r.list)) per(get(id), r.id).value += n(l.net);
  }
  for (const l of promoLines.back) {
    const id = l.staff_user_id ? String(l.staff_user_id) : null;
    if (!id) continue;
    const date = String(l.return_date);
    const inLists = listsOf(promos, l, date);
    const g = groupOf(id);
    for (const r of unitRules) if (inForce(r, date) && r.groups.includes(g) && inLists.has(r.list)) per(get(id), r.id).units -= n(l.quantity);
    for (const r of valueRules) if (r.groups.includes(g) && inLists.has(r.list)) per(get(id), r.id).value -= n(l.net);
  }
  for (const a of acc.values()) {
    for (const r of unitRules) {
      const p = a.per.get(r.id);
      if (p) p.amount = Math.max(0, p.units) * r.amount;
    }
    for (const r of valueRules) {
      const p = a.per.get(r.id);
      if (p) p.amount = slabFor(r.slabs, Math.max(0, p.value))?.amount ?? 0;
    }
  }

  // ---- Stores
  const storeNames = new Set<string>();
  for (const s of Object.keys(settings.storeTargets)) storeNames.add(s.toUpperCase());
  for (const b of invoices) if (b.store) storeNames.add(b.store);
  for (const s of [...storeNames]) if (excluded.has(s) || s === CORPORATE_OFFICE) storeNames.delete(s);

  const stores: StoreReport[] = [];

  for (const store of [...storeNames].sort()) {
    const bills = invoices.filter((b) => b.store === store);
    const back = returns.filter((r) => r.store === store);
    const invoiceNet = bills.reduce((s, b) => s + b.net, 0);
    const returnsValue = back.reduce((s, r) => s + r.net, 0);
    const net = invoiceNet - returnsValue;
    const target = targets.stores.get(store) ?? settings.storeTargets[store] ?? 0;
    const achievement = target > 0 ? net / target : 0;
    const poolRate = poolRule && target > 0 ? slabFor(poolRule.slabs, achievement)?.rate ?? 0 : 0;
    const pool = poolRate * Math.max(0, net);
    const next = poolRule && target > 0 ? nextSlab(poolRule.slabs, achievement) : null;

    // People of this store: staff whose (incentive) store is this one, plus anyone (e.g. PT staff)
    // who mostly sold here. People not in incentive are left out; their bills count as "Others".
    const members = new Map<string, StaffRow | null>();
    for (const s of staff) if (storeOf(s) === store && s.group !== "none") members.set(s.userId, s);
    for (const [id, a] of acc) {
      if (members.has(id)) continue;
      const s = staffById.get(id);
      if (s && (s.group === "none" || (storeOf(s) && storeOf(s) !== store && storeNames.has(storeOf(s) as string)))) continue;
      if (!s && !isPtCode(id)) continue; // unknown codes are listed for linking instead
      const mainStore = [...a.stores.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      if (mainStore === store) members.set(id, s ?? null);
    }

    const people: PersonReport[] = [];
    for (const [id, s] of members) {
      const a = acc.get(id) ?? get(id);
      const t = targets.staff.get(id);
      const pnet = a.invoiceNet - a.returns;
      const group = groupOf(id);
      const pt = isPtCode(id);
      people.push({
        staffId: s?.id ?? null,
        userId: id,
        name: s?.name ?? (pt ? settings.ptPeople[id]?.name : undefined) ?? spName.get(id) ?? id,
        roleLabel: s?.roleLabel ?? (pt ? "Daily wages" : "—"),
        group,
        store,
        isPt: pt,
        bills: a.bills,
        units: a.units,
        gross: a.gross,
        discount: a.discount,
        invoiceNet: a.invoiceNet,
        returns: a.returns,
        returnCount: a.returnCount,
        net: pnet,
        abv: a.bills ? pnet / a.bills : 0,
        discountPct: a.gross ? a.discount / a.gross : 0,
        flaggedBills: a.flaggedBills,
        target: t?.sales || null,
        abvTarget: t?.abv ?? null,
        achievement: t?.sales ? pnet / t.sales : null,
        storeShare: 0,
        bonus: 0,
        spotTotal: 0,
        lines: [],
        lostToReturns: a.lostToReturns,
        lostNotes: [],
        attendance: attendanceFor(month, duties.days.get(id), duties.withData, settings.dutiesRequired),
        earnedBeforeAttendance: 0,
        attendanceCut: 0,
        total: 0,
      });
    }

    // Store pool split: the Sales Team by sales, every other group equally.
    if (poolRule && pool > 0) {
      for (const [g, share] of Object.entries(poolRule.split) as [IncentiveGroup, number][]) {
        if (!share) continue;
        const list = people.filter((p) => p.group === g);
        if (!list.length) continue;
        if (g === "sales") {
          const total = list.reduce((s, p) => s + Math.max(0, p.net), 0);
          for (const p of list) p.storeShare += total > 0 ? (pool * share * Math.max(0, p.net)) / total : 0;
        } else {
          for (const p of list) p.storeShare += (pool * share) / list.length;
        }
      }
    }

    for (const p of people) {
      const a = acc.get(p.userId)!;
      const pct = (x: number) => `${Math.round(x * 100)}%`;
      for (const r of achRules) {
        if (!r.groups.includes(p.group)) continue;
        const amount = p.achievement !== null ? slabFor(r.slabs, p.achievement)?.amount ?? 0 : 0;
        p.lines.push({ ruleId: r.id, name: r.name, kind: r.kind, note: p.achievement !== null ? `${pct(p.achievement)} of target` : "Needs a target", amount });
        p.bonus += amount;
      }
      for (const r of abvRules) {
        if (!r.groups.includes(p.group) || !p.bills) continue;
        const amount = abvAmount(r, p.achievement, p.abv);
        p.lines.push({
          ruleId: r.id,
          name: r.name,
          kind: r.kind,
          note: `ABV ₹${Math.round(p.abv).toLocaleString("en-IN")}${p.achievement !== null ? ` with ${pct(p.achievement)} of target` : " · needs a target"}`,
          amount,
        });
        p.bonus += amount;
      }
      for (const r of [...billRules, ...unitRules, ...valueRules]) {
        if (!r.groups.includes(p.group)) continue;
        const x = a.per.get(r.id) ?? { count: 0, amount: 0, units: 0, value: 0, lost: 0, lostCount: 0 };
        const note =
          r.kind === "product_units"
            ? `${Math.max(0, x.units)} × ₹${r.amount}`
            : r.kind === "product_value"
              ? `₹${Math.round(Math.max(0, x.value)).toLocaleString("en-IN")} sold`
              : `${x.count} × ₹${r.amount.toLocaleString("en-IN")}`;
        p.lines.push({ ruleId: r.id, name: versionName(r, mFrom, mTo), kind: r.kind, note, amount: x.amount });
        p.spotTotal += x.amount;
        if (x.lostCount) p.lostNotes.push(`${x.lostCount} ${r.name} bill(s) were returned (₹${x.lost.toLocaleString("en-IN")})`);
      }
      if (p.group === "none") p.storeShare = 0;
      p.earnedBeforeAttendance = p.storeShare + p.bonus + p.spotTotal;
      const share = p.attendance.found ? p.attendance.share : 1;
      p.total = p.earnedBeforeAttendance * share;
      p.attendanceCut = p.earnedBeforeAttendance - p.total;
    }
    people.sort((x, y) => y.net - x.net);

    // "Others": bills without a salesperson, or billed by someone who is not in incentive.
    const others = bills.filter((b) => !b.staff_user_id || notInIncentive.has(b.staff_user_id));
    stores.push({
      month,
      store,
      target,
      gross: bills.reduce((s, b) => s + b.gross, 0),
      discount: bills.reduce((s, b) => s + b.discount, 0),
      invoiceNet,
      returns: returnsValue,
      net,
      bills: bills.length,
      achievement,
      poolName: poolRule?.name ?? null,
      poolRate,
      pool,
      nextSlab: next ? { from: next.from, rate: next.rate, needed: Math.max(0, next.from * target - net) } : null,
      othersNet: others.reduce((s, b) => s + b.net, 0),
      othersBills: others.length,
      othersGross: others.reduce((s, b) => s + b.gross, 0),
      othersDiscount: others.reduce((s, b) => s + b.discount, 0),
      othersFlagged: others.filter((b) => discountShare(b) > threshold).length,
      units: bills.reduce((s, b) => s + b.quantity, 0),
      returnCount: back.length,
      spotCounts: billRules
        .filter((r) => inForce(r, mTo) || (r.to && r.to >= mFrom))
        .map((r) => ({ name: r.name, count: bills.filter((b) => inForce(r, b.invoice_date) && billQualifies(b, r) && !returnedBills.has(b.invoice_id)).length })),
      people,
      flagged: bills.filter((b) => discountShare(b) > threshold).sort((x, y) => discountShare(y) - discountShare(x)),
      daysInMonth,
      daysGone,
    });
  }

  const lastBillDate = invoices.reduce<string | null>((m, b) => (!m || b.invoice_date > m ? b.invoice_date : m), null);
  const value: MonthReport = {
    month,
    settings,
    rules,
    stores,
    unlinked: [...unlinked.values()].sort((x, y) => y.net - x.net),
    lastBillDate,
  };
  cache = { key: month, at: Date.now(), value };
  return value;
}

// ------------------------------------------------------------------
// One person in detail (items, categories, bills to look at)
// ------------------------------------------------------------------

export type NearMiss = { name: string; amount: number; bills: { invoice_number: string; total: number; gap: string }[] };

export type PersonDetail = {
  categories: { name: string; units: number; net: number }[];
  items: { name: string; units: number; net: number }[];
  flagged: (InvoiceRow & { pct: number })[];
  nearMisses: NearMiss[];
  returned: ReturnRow[];
  daily: { date: string; net: number; bills: number }[];
};

export async function personDetail(month: string, userId: string, threshold: number, monthRules: IncentiveRule[]): Promise<PersonDetail> {
  const { from, to } = monthRange(month);
  const offerRules = monthRules.filter((r): r is ProductUnitsRule => r.kind === "product_units" && r.freeNotDiscount);
  const [bills, lines, back, promosRes] = await Promise.all([
    fetchAll<Row>((a, b) =>
      supabaseAdmin.from("sales_invoices").select(INVOICE_COLS).eq("staff_user_id", userId).gte("invoice_date", from).lte("invoice_date", to).order("invoice_id").range(a, b)
    ),
    fetchAll<Row>((a, b) =>
      supabaseAdmin
        .from("sales_invoice_lines")
        .select("name, category, quantity, net")
        .eq("staff_user_id", userId)
        .gte("invoice_date", from)
        .lte("invoice_date", to)
        .order("line_item_id")
        .range(a, b)
    ),
    supabaseAdmin
      .from("sales_returns")
      .select("creditnote_id, creditnote_number, return_date, store, staff_user_id, invoice_id, invoice_number, net")
      .eq("staff_user_id", userId)
      .gte("return_date", from)
      .lte("return_date", to)
      .order("return_date", { ascending: false })
      .limit(500),
    offerRules.length
      ? supabaseAdmin.from("promo_products").select("id, kind, item_id, sku, name, from_date, to_date").in("kind", offerRules.map((r) => r.list)).limit(10000)
      : Promise.resolve({ data: [] as PromoRow[] }),
  ]);

  // Free items of offers are not staff discount (same as the month report).
  const promos = (promosRes.data ?? []) as PromoRow[];
  const offerDisc = promos.length ? offerDiscounts(offerRules, promos, (await loadPromoLines(month, promos, userId)).sold) : new Map<string, number>();
  const inv = bills.map(normInvoice).map((b) => (offerDisc.has(b.invoice_id) ? { ...b, discount: Math.max(0, b.discount - (offerDisc.get(b.invoice_id) ?? 0)) } : b));

  const cat = new Map<string, { name: string; units: number; net: number }>();
  const item = new Map<string, { name: string; units: number; net: number }>();
  for (const l of lines) {
    if (/carry\s*bag/i.test(String(l.category ?? ""))) continue;
    const c = String(l.category || "Other");
    const ce = cat.get(c) ?? { name: c, units: 0, net: 0 };
    ce.units += n(l.quantity);
    ce.net += n(l.net);
    cat.set(c, ce);
    const name = String(l.name || "Item");
    const ie = item.get(name) ?? { name, units: 0, net: 0 };
    ie.units += n(l.quantity);
    ie.net += n(l.net);
    item.set(name, ie);
  }
  const daily = new Map<string, { date: string; net: number; bills: number }>();
  for (const b of inv) {
    const d = daily.get(b.invoice_date) ?? { date: b.invoice_date, net: 0, bills: 0 };
    d.net += b.net;
    d.bills++;
    daily.set(b.invoice_date, d);
  }

  // Bills that just missed a per-bill incentive.
  const nearMisses: NearMiss[] = [];
  for (const r of monthRules.filter((x): x is BillValueRule | WowRule => x.kind === "bill_value" || x.kind === "wow")) {
    const list = inv.filter((b) => inForce(r, b.invoice_date) && !billQualifies(b, r));
    const bills =
      r.kind === "bill_value"
        ? list.filter((b) => b.total >= r.minBill * 0.9).map((b) => ({ invoice_number: b.invoice_number, total: b.total, gap: `₹${Math.ceil(r.minBill - b.total).toLocaleString("en-IN")} short` }))
        : list
            .filter((b) => b.total >= r.minBill)
            .map((b) => ({ b, gaps: wowGaps(b, r) }))
            .filter((x) => x.gaps.length === 1)
            .map((x) => ({ invoice_number: x.b.invoice_number, total: x.b.total, gap: x.gaps[0] }));
    if (bills.length) nearMisses.push({ name: r.name, amount: r.amount, bills });
  }

  return {
    categories: [...cat.values()].sort((a, b) => b.net - a.net),
    items: [...item.values()].sort((a, b) => b.units - a.units || b.net - a.net),
    flagged: inv
      .map((b) => ({ ...b, pct: discountShare(b) }))
      .filter((b) => b.pct > threshold)
      .sort((a, b) => b.pct - a.pct),
    nearMisses,
    returned: ((back.data ?? []) as Row[]).map(normReturn),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ------------------------------------------------------------------
// Store comparisons and salaries
// ------------------------------------------------------------------

/** Monthly salaries (User ID / PT code → ₹). Management view only. */
export async function loadSalaries(): Promise<Map<string, number>> {
  const { data } = await supabaseAdmin.from("staff_salaries").select("user_id, monthly_salary").limit(5000);
  return new Map(((data ?? []) as Row[]).map((r) => [attendanceCode(r.user_id), n(r.monthly_salary)]));
}

export type PeriodTotals = { net: number; bills: number; units: number; gross: number; discount: number; returns: number };

/** The same days of the month before (1 … upToDay), for "vs last month". */
export async function storePreviousPeriod(month: string, store: string, upToDay: number): Promise<PeriodTotals | null> {
  const [y, m] = month.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const pm = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  const { days } = monthRange(pm);
  const to = `${pm}-${String(Math.min(Math.max(1, upToDay), days)).padStart(2, "0")}`;
  const [bills, back] = await Promise.all([
    fetchAll<Row>((a, b) =>
      supabaseAdmin.from("sales_invoices").select("invoice_date, net, gross, discount, quantity").eq("store", store).gte("invoice_date", `${pm}-01`).lte("invoice_date", to).order("invoice_id").range(a, b)
    ),
    fetchAll<Row>((a, b) => supabaseAdmin.from("sales_returns").select("net").eq("store", store).gte("return_date", `${pm}-01`).lte("return_date", to).order("creditnote_id").range(a, b)),
  ]);
  // Compare only when last month's bills are copied for (nearly) every one of those days.
  const daysWithBills = new Set(bills.map((b) => String(b.invoice_date))).size;
  if (!bills.length || daysWithBills < Math.max(1, Math.min(upToDay, days) - 1)) return null;
  const returns = back.reduce((s, r) => s + n(r.net), 0);
  return {
    net: bills.reduce((s, b) => s + n(b.net), 0) - returns,
    bills: bills.length,
    units: bills.reduce((s, b) => s + n(b.quantity), 0),
    gross: bills.reduce((s, b) => s + n(b.gross), 0),
    discount: bills.reduce((s, b) => s + n(b.discount), 0),
    returns,
  };
}

// ------------------------------------------------------------------
// Yearly incentives (financial year April–March)
// ------------------------------------------------------------------

export type YearlyLine = { name: string; fy: string; target: number; net: number; achievement: number | null; amount: number; next: { from: number; amount: number } | null };

export async function yearlyProgress(userId: string, group: IncentiveGroup, today: string): Promise<YearlyLine[]> {
  const fy = financialYear(today);
  const rules = (await loadIncentiveRules()).filter(
    (r): r is YearlyAchievementRule => r.kind === "yearly_achievement" && (inForce(r, today) || inForce(r, fy.to)) && r.groups.includes(group)
  );
  if (!rules.length) return [];
  const upTo = today < fy.to ? today : fy.to;
  const [targets, bills, back] = await Promise.all([
    supabaseAdmin.from("staff_sales_targets").select("sales_target").eq("user_id", userId).gte("month", fy.from.slice(0, 7)).lte("month", fy.to.slice(0, 7)),
    fetchAll<Row>((a, b) => supabaseAdmin.from("sales_invoices").select("net").eq("staff_user_id", userId).gte("invoice_date", fy.from).lte("invoice_date", upTo).order("invoice_id").range(a, b)),
    fetchAll<Row>((a, b) => supabaseAdmin.from("sales_returns").select("net").eq("staff_user_id", userId).gte("return_date", fy.from).lte("return_date", upTo).order("creditnote_id").range(a, b)),
  ]);
  const target = ((targets.data ?? []) as Row[]).reduce((s, t) => s + n(t.sales_target), 0);
  const net = bills.reduce((s, b) => s + n(b.net), 0) - back.reduce((s, r) => s + n(r.net), 0);
  const achievement = target > 0 ? net / target : null;
  return rules.map((r) => ({
    name: r.name,
    fy: fy.label,
    target,
    net,
    achievement,
    amount: achievement !== null ? slabFor(r.slabs, achievement)?.amount ?? 0 : 0,
    next: achievement !== null ? nextSlab(r.slabs, achievement) : null,
  }));
}
