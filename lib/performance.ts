// Sales performance: targets, achievement, incentives earned and lost. Server only.
// Numbers come from the bills and returns copied from Zoho POS (lib/sales-sync.ts).

import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";
import { asRole, ROLE_LABELS } from "@/lib/roles";
import { loadAccessConfig } from "@/lib/access-config";
import { attendanceCode } from "@/lib/attendance";
import { CORPORATE_OFFICE } from "@/lib/stores";
import { loadPerformanceSettings } from "@/lib/performance-settings";
import {
  ABV_GROUPS,
  abvBonus,
  attendanceShare,
  defaultGroup,
  individualBonus,
  INDIVIDUAL_BONUS_GROUPS,
  isGroup,
  MANAGER_SPLIT,
  monthRange,
  nextIndividualSlab,
  nextStoreSlab,
  POOL_SPLIT,
  slowMovingReward,
  SPOT,
  storePoolRate,
  type IncentiveGroup,
  type PerformanceSettings,
} from "@/lib/performance-rules";

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

type PromoRow = { id: number; kind: "slow_moving" | "b2g1"; item_id: string | null; sku: string | null; name: string; from_date: string | null; to_date: string | null };

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

async function loadMonth(month: string) {
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
    supabaseAdmin.from("promo_products").select("id, kind, item_id, sku, name, from_date, to_date").limit(5000),
  ]);
  return {
    invoices: invoices.map(normInvoice),
    returns: returns.map((r) => ({
      creditnote_id: String(r.creditnote_id),
      creditnote_number: String(r.creditnote_number ?? ""),
      return_date: String(r.return_date),
      store: (r.store as string) ?? null,
      staff_user_id: (r.staff_user_id as string) ?? null,
      invoice_id: (r.invoice_id as string) ?? null,
      invoice_number: (r.invoice_number as string) ?? null,
      net: n(r.net),
    })) as ReturnRow[],
    promos: ((promos.data ?? []) as PromoRow[]).filter((p) => {
      // active at some point in this month
      const { from: mf, to: mt } = monthRange(month);
      return (!p.from_date || p.from_date <= mt) && (!p.to_date || p.to_date >= mf);
    }),
  };
}

/** Promo lines (Slow-moving / B2G1) sold and returned in the month. */
async function loadPromoLines(month: string, promos: PromoRow[]) {
  const { from, to } = monthRange(month);
  const ids = [...new Set(promos.map((p) => p.item_id).filter(Boolean) as string[])];
  const skus = [...new Set(promos.filter((p) => !p.item_id && p.sku).map((p) => p.sku as string))];
  const sold: Row[] = [];
  const back: Row[] = [];
  const chunks = <T,>(list: T[]) => Array.from({ length: Math.ceil(list.length / 150) }, (_, i) => list.slice(i * 150, i * 150 + 150));
  for (const [col, values] of [["item_id", ids], ["sku", skus]] as const) {
    for (const part of chunks(values)) {
      sold.push(
        ...(await fetchAll<Row>((a, b) =>
          supabaseAdmin
            .from("sales_invoice_lines")
            .select("invoice_id, invoice_date, staff_user_id, store, item_id, sku, quantity, net")
            .in(col, part)
            .gte("invoice_date", from)
            .lte("invoice_date", to)
            .order("line_item_id")
            .range(a, b)
        ))
      );
      back.push(
        ...(await fetchAll<Row>((a, b) =>
          supabaseAdmin
            .from("sales_return_lines")
            .select("return_date, staff_user_id, store, item_id, sku, quantity, net")
            .in(col, part)
            .gte("return_date", from)
            .lte("return_date", to)
            .order("line_item_id")
            .range(a, b)
        ))
      );
    }
  }
  return { sold, back };
}

function promoKind(promos: PromoRow[], line: Row, date: string) {
  const kinds = new Set<string>();
  for (const p of promos) {
    const match = (p.item_id && p.item_id === line.item_id) || (!p.item_id && p.sku && p.sku === line.sku);
    if (!match) continue;
    if (p.from_date && date < p.from_date) continue;
    if (p.to_date && date > p.to_date) continue;
    kinds.add(p.kind);
  }
  return kinds;
}

// ------------------------------------------------------------------
// Staff, targets, attendance
// ------------------------------------------------------------------

type StaffRow = {
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

export type Attendance = { duties: number; required: number; remaining: number; absences: number; share: number; found: boolean };

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
  for (const r of rows) {
    const code = attendanceCode(r.emp_code);
    const day = todayISO(new Date(String(r.punch_time)));
    if (!days.has(code)) days.set(code, new Set());
    days.get(code)!.add(day);
  }
  return days;
}

function attendanceFor(month: string, days: Set<string> | undefined, required: number): Attendance {
  const { days: inMonth } = monthRange(month);
  const today = todayISO();
  const duties = days?.size ?? 0;
  let remaining = 0;
  if (today.slice(0, 7) === month) {
    const day = Number(today.slice(8, 10));
    remaining = inMonth - day + (days?.has(today) ? 0 : 1);
  } else if (today.slice(0, 7) < month) {
    remaining = inMonth;
  }
  // Absences that can no longer be made up (the 26-duty rule).
  const absences = Math.max(0, required - duties - remaining);
  return { duties, required, remaining, absences, share: attendanceShare(absences), found: duties > 0 };
}

// ------------------------------------------------------------------
// Report
// ------------------------------------------------------------------

export type Spot = {
  highValue: { count: number; amount: number; returned: number };
  wow: { count: number; amount: number; returned: number };
  b2g1: { units: number; amount: number };
  slowMoving: { value: number; amount: number };
  total: number;
};

export type PersonReport = {
  staffId: string | null;
  userId: string;
  name: string;
  roleLabel: string;
  group: IncentiveGroup;
  store: string | null;
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
  individualBonus: number;
  abvBonus: number;
  spot: Spot;
  attendance: Attendance;
  earnedBeforeAttendance: number;
  attendanceCut: number;
  total: number;
  lostToReturns: number;
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
  poolRate: number;
  pool: number;
  nextSlab: { from: number; rate: number; needed: number } | null;
  othersNet: number;
  othersBills: number;
  people: PersonReport[];
  flagged: InvoiceRow[];
  daysInMonth: number;
  daysGone: number;
};

export type MonthReport = {
  month: string;
  settings: PerformanceSettings;
  stores: StoreReport[];
  /** Zoho salesperson names that are not linked to any staff User ID. */
  unlinked: { name: string; net: number; bills: number }[];
  lastBillDate: string | null;
};

const emptySpot = (): Spot => ({
  highValue: { count: 0, amount: 0, returned: 0 },
  wow: { count: 0, amount: 0, returned: 0 },
  b2g1: { units: 0, amount: 0 },
  slowMoving: { value: 0, amount: 0 },
  total: 0,
});

export function isWowBill(b: InvoiceRow) {
  return (
    b.total >= SPOT.wowBill &&
    b.quantity >= SPOT.wowMinUnits &&
    b.category_count >= SPOT.wowMinCategories &&
    b.units_under_5k >= SPOT.wowMinUnder5k &&
    b.max_line_share <= SPOT.wowMaxShare
  );
}

/** Why a ₹10,000+ bill is not a WOW bill (empty when it is). */
export function wowGaps(b: InvoiceRow) {
  const gaps: string[] = [];
  if (b.total < SPOT.wowBill) gaps.push(`bill below ₹10,000`);
  if (b.quantity < SPOT.wowMinUnits) gaps.push(`${SPOT.wowMinUnits - b.quantity} more item(s)`);
  if (b.category_count < SPOT.wowMinCategories) gaps.push(`${SPOT.wowMinCategories - b.category_count} more categor${SPOT.wowMinCategories - b.category_count === 1 ? "y" : "ies"}`);
  if (b.units_under_5k < SPOT.wowMinUnder5k) gaps.push(`${SPOT.wowMinUnder5k - b.units_under_5k} more item(s) under ₹5,000`);
  if (b.max_line_share > SPOT.wowMaxShare) gaps.push(`one item is ${Math.round(b.max_line_share * 100)}% of the bill (max 60%)`);
  return gaps;
}

export const discountShare = (b: { gross: number; discount: number }) => (b.gross > 0 ? b.discount / b.gross : 0);

let cache: { key: string; at: number; value: MonthReport } | null = null;

export async function monthReport(month: string, fresh = false): Promise<MonthReport> {
  if (!fresh && cache && cache.key === month && Date.now() - cache.at < 60_000) return cache.value;

  const settings = await loadPerformanceSettings();
  const [{ invoices, returns, promos }, staff, targets, duties] = await Promise.all([
    loadMonth(month),
    loadStaffForPerformance(),
    loadTargets(month),
    loadDuties(month),
  ]);
  const promoLines = promos.length ? await loadPromoLines(month, promos) : { sold: [], back: [] };

  const excluded = new Set(settings.excludedStores.map((s) => s.toUpperCase()));
  const { days: daysInMonth } = monthRange(month);
  const today = todayISO();
  const daysGone = today.slice(0, 7) > month ? daysInMonth : today.slice(0, 7) < month ? 0 : Number(today.slice(8, 10));

  // Bills returned (any time up to now) do not earn spot incentives.
  const candidates = invoices.filter((b) => b.total >= SPOT.wowBill).map((b) => b.invoice_id);
  const returnedBills = new Set<string>();
  for (let i = 0; i < candidates.length; i += 200) {
    const { data } = await supabaseAdmin.from("sales_returns").select("invoice_id").in("invoice_id", candidates.slice(i, i + 200));
    for (const r of data ?? []) if (r.invoice_id) returnedBills.add(String(r.invoice_id));
  }

  // ---- Per person (by User ID)
  type Acc = Omit<PersonReport, "staffId" | "name" | "roleLabel" | "group" | "store" | "target" | "abvTarget" | "achievement" | "storeShare" | "individualBonus" | "abvBonus" | "attendance" | "earnedBeforeAttendance" | "attendanceCut" | "total" | "abv" | "discountPct" | "net"> & { stores: Map<string, number> };
  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    if (!acc.has(id)) {
      acc.set(id, { userId: id, bills: 0, units: 0, gross: 0, discount: 0, invoiceNet: 0, returns: 0, returnCount: 0, flaggedBills: 0, spot: emptySpot(), lostToReturns: 0, stores: new Map() });
    }
    return acc.get(id)!;
  };
  const threshold = settings.highDiscountPct / 100;
  const unlinked = new Map<string, { name: string; net: number; bills: number }>();

  for (const b of invoices) {
    if (!b.staff_user_id) {
      const key = b.salesperson?.trim() || "";
      if (key) {
        const u = unlinked.get(key) ?? { name: key, net: 0, bills: 0 };
        u.net += b.net;
        u.bills++;
        unlinked.set(key, u);
      }
      continue;
    }
    const a = get(b.staff_user_id);
    a.bills++;
    a.units += b.quantity;
    a.gross += b.gross;
    a.discount += b.discount;
    a.invoiceNet += b.net;
    if (b.store) a.stores.set(b.store, (a.stores.get(b.store) ?? 0) + b.net);
    if (discountShare(b) > threshold) a.flaggedBills++;
    const returned = returnedBills.has(b.invoice_id);
    if (b.total >= SPOT.highValueBill) {
      if (returned) {
        a.spot.highValue.returned++;
        a.lostToReturns += SPOT.highValueReward;
      } else {
        a.spot.highValue.count++;
        a.spot.highValue.amount += SPOT.highValueReward;
      }
    }
    if (isWowBill(b)) {
      if (returned) {
        a.spot.wow.returned++;
        a.lostToReturns += SPOT.wowReward;
      } else {
        a.spot.wow.count++;
        a.spot.wow.amount += SPOT.wowReward;
      }
    }
  }
  for (const r of returns) {
    if (!r.staff_user_id) continue;
    const a = get(r.staff_user_id);
    a.returns += r.net;
    a.returnCount++;
  }
  // Promo products
  const slowValue = new Map<string, number>();
  for (const l of promoLines.sold) {
    const id = l.staff_user_id ? String(l.staff_user_id) : null;
    if (!id) continue;
    const kinds = promoKind(promos, l, String(l.invoice_date));
    if (kinds.has("b2g1")) get(id).spot.b2g1.units += n(l.quantity);
    if (kinds.has("slow_moving")) slowValue.set(id, (slowValue.get(id) ?? 0) + n(l.net));
  }
  for (const l of promoLines.back) {
    const id = l.staff_user_id ? String(l.staff_user_id) : null;
    if (!id) continue;
    const kinds = promoKind(promos, l, String(l.return_date));
    if (kinds.has("b2g1")) get(id).spot.b2g1.units -= n(l.quantity);
    if (kinds.has("slow_moving")) slowValue.set(id, (slowValue.get(id) ?? 0) - n(l.net));
  }
  for (const a of acc.values()) {
    a.spot.b2g1.units = Math.max(0, a.spot.b2g1.units);
    a.spot.b2g1.amount = a.spot.b2g1.units * SPOT.b2g1PerUnit;
    const sv = Math.max(0, slowValue.get(a.userId) ?? 0);
    a.spot.slowMoving = { value: sv, amount: slowMovingReward(sv) };
    a.spot.total = a.spot.highValue.amount + a.spot.wow.amount + a.spot.b2g1.amount + a.spot.slowMoving.amount;
  }

  // ---- Stores
  const storeNames = new Set<string>();
  for (const s of Object.keys(settings.storeTargets)) storeNames.add(s.toUpperCase());
  for (const b of invoices) if (b.store) storeNames.add(b.store);
  for (const s of [...storeNames]) if (excluded.has(s) || s === CORPORATE_OFFICE) storeNames.delete(s);

  const staffById = new Map(staff.map((s) => [s.userId, s]));
  const stores: StoreReport[] = [];

  for (const store of [...storeNames].sort()) {
    const bills = invoices.filter((b) => b.store === store);
    const back = returns.filter((r) => r.store === store);
    const invoiceNet = bills.reduce((s, b) => s + b.net, 0);
    const returnsValue = back.reduce((s, r) => s + r.net, 0);
    const net = invoiceNet - returnsValue;
    const target = targets.stores.get(store) ?? settings.storeTargets[store] ?? 0;
    const achievement = target > 0 ? net / target : 0;
    const poolRate = storePoolRate(achievement);
    const pool = poolRate * Math.max(0, net);
    const next = target > 0 ? nextStoreSlab(achievement) : null;

    // People of this store: staff whose store is this one, plus anyone who mostly sold here.
    const members = new Map<string, StaffRow | null>();
    for (const s of staff) if (s.store === store) members.set(s.userId, s);
    for (const [id, a] of acc) {
      if (members.has(id)) continue;
      const s = staffById.get(id);
      if (s && s.store && s.store !== store && storeNames.has(s.store)) continue;
      const mainStore = [...a.stores.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      if (mainStore === store) members.set(id, s ?? null);
    }

    const people: PersonReport[] = [];
    for (const [id, s] of members) {
      const a = acc.get(id) ?? get(id);
      const t = targets.staff.get(id);
      const pnet = a.invoiceNet - a.returns;
      const group = s?.group ?? "sales";
      people.push({
        staffId: s?.id ?? null,
        userId: id,
        name: s?.name ?? id,
        roleLabel: s?.roleLabel ?? "Not in Staff Users",
        group,
        store,
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
        individualBonus: 0,
        abvBonus: 0,
        spot: a.spot,
        attendance: attendanceFor(month, duties.get(id), settings.dutiesRequired),
        earnedBeforeAttendance: 0,
        attendanceCut: 0,
        total: 0,
        lostToReturns: a.lostToReturns,
      });
    }

    // Store pool split
    const inGroup = (g: IncentiveGroup) => people.filter((p) => p.group === g);
    const equal = (g: IncentiveGroup, amount: number) => {
      const list = inGroup(g);
      for (const p of list) p.storeShare += amount / list.length;
    };
    equal("sm", pool * POOL_SPLIT.managers * MANAGER_SPLIT.sm);
    equal("asm", pool * POOL_SPLIT.managers * MANAGER_SPLIT.asm);
    equal("cashier_cre", pool * POOL_SPLIT.cashier_cre);
    equal("backend", pool * POOL_SPLIT.backend);
    equal("vm", pool * POOL_SPLIT.vm);
    equal("housekeeping", pool * POOL_SPLIT.housekeeping);
    const sales = inGroup("sales");
    const salesTotal = sales.reduce((s, p) => s + Math.max(0, p.net), 0);
    for (const p of sales) p.storeShare += salesTotal > 0 ? (pool * POOL_SPLIT.sales * Math.max(0, p.net)) / salesTotal : 0;

    for (const p of people) {
      if (INDIVIDUAL_BONUS_GROUPS.includes(p.group) && p.achievement !== null) p.individualBonus = individualBonus(p.achievement);
      if (ABV_GROUPS.includes(p.group) && p.bills > 0) p.abvBonus = abvBonus(p.achievement, p.abv);
      if (p.group === "none") p.storeShare = 0;
      p.earnedBeforeAttendance = p.storeShare + p.individualBonus + p.abvBonus + p.spot.total;
      const share = p.attendance.found ? p.attendance.share : 1;
      p.total = p.earnedBeforeAttendance * share;
      p.attendanceCut = p.earnedBeforeAttendance - p.total;
    }
    people.sort((x, y) => y.net - x.net);

    const others = bills.filter((b) => !b.staff_user_id);
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
      poolRate,
      pool,
      nextSlab: next ? { ...next, needed: Math.max(0, next.from * target - net) } : null,
      othersNet: others.reduce((s, b) => s + b.net, 0),
      othersBills: others.length,
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
    stores,
    unlinked: [...unlinked.values()].sort((x, y) => y.net - x.net),
    lastBillDate,
  };
  cache = { key: month, at: Date.now(), value };
  return value;
}

// ------------------------------------------------------------------
// One person in detail (items, categories, bills to look at, insights)
// ------------------------------------------------------------------

export type PersonDetail = {
  categories: { name: string; units: number; net: number }[];
  items: { name: string; units: number; net: number }[];
  flagged: (InvoiceRow & { pct: number })[];
  nearHighValue: InvoiceRow[];
  nearWow: (InvoiceRow & { gaps: string[] })[];
  returned: ReturnRow[];
  daily: { date: string; net: number; bills: number }[];
};

export async function personDetail(month: string, userId: string, threshold: number): Promise<PersonDetail> {
  const { from, to } = monthRange(month);
  const [bills, lines, back] = await Promise.all([
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
  ]);
  const inv = bills.map(normInvoice);
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
  return {
    categories: [...cat.values()].sort((a, b) => b.net - a.net),
    items: [...item.values()].sort((a, b) => b.units - a.units || b.net - a.net),
    flagged: inv
      .map((b) => ({ ...b, pct: discountShare(b) }))
      .filter((b) => b.pct > threshold)
      .sort((a, b) => b.pct - a.pct),
    nearHighValue: inv.filter((b) => b.total >= SPOT.highValueBill * 0.9 && b.total < SPOT.highValueBill),
    nearWow: inv
      .filter((b) => b.total >= SPOT.wowBill && !isWowBill(b))
      .map((b) => ({ ...b, gaps: wowGaps(b) }))
      .filter((b) => b.gaps.length === 1),
    returned: ((back.data ?? []) as Row[]).map((r) => ({
      creditnote_id: String(r.creditnote_id),
      creditnote_number: String(r.creditnote_number ?? ""),
      return_date: String(r.return_date),
      store: (r.store as string) ?? null,
      staff_user_id: (r.staff_user_id as string) ?? null,
      invoice_id: (r.invoice_id as string) ?? null,
      invoice_number: (r.invoice_number as string) ?? null,
      net: n(r.net),
    })),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export { nextIndividualSlab };
