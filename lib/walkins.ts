// Walk-ins per store and day (server only), posted by the store's CRE (Cashier / CRE group),
// or corrected by the Store Manager / ASM / Floor Manager or management. One running total for the day:
// the CRE updates it as the day goes on; every change is kept in the change history.
// Conversion = bills ÷ walk-ins.

import { supabaseAdmin } from "@/lib/supabase/server";
import type { StaffUser } from "@/lib/auth";
import { loadPerformanceSettings } from "@/lib/performance-settings";
import { defaultGroup, isGroup, type IncentiveGroup } from "@/lib/performance-rules";
import { merchStores } from "@/lib/merch-access";

export type Walkins = { store: string; day: string; count: number; updated_by_name: string | null; updated_at: string };

export async function loadWalkins(store: string, day: string): Promise<Walkins | null> {
  const { data } = await supabaseAdmin.from("walkin_counts").select("store, day, count, updated_by_name, updated_at").eq("store", store).eq("day", day).maybeSingle();
  return (data as Walkins | null) ?? null;
}

export async function loadWalkinsMany(stores: string[], day: string): Promise<Map<string, Walkins>> {
  if (!stores.length) return new Map();
  const { data } = await supabaseAdmin.from("walkin_counts").select("store, day, count, updated_by_name, updated_at").eq("day", day).in("store", stores);
  return new Map(((data ?? []) as Walkins[]).map((w) => [w.store, w]));
}

/** The store whose walk-ins this person posts as CRE (their own store), or null. */
export async function creStoreOf(staff: StaffUser): Promise<string | null> {
  // Only this person's group (one small read), not the whole staff list — this runs on every page.
  const [s, { data }] = await Promise.all([
    loadPerformanceSettings(),
    supabaseAdmin.from("staff_users").select("incentive_group").eq("id", staff.id).maybeSingle(),
  ]);
  const group = isGroup(data?.incentive_group)
    ? (data!.incentive_group as IncentiveGroup)
    : isGroup(staff.access.group)
      ? (staff.access.group as IncentiveGroup)
      : defaultGroup(staff.role, staff.access.roleLabel, s.asmIsFm);
  const store = (staff.storeName ?? "").toUpperCase();
  return group === "cashier_cre" && store ? store : null;
}

/** Can this person post walk-ins for the store? CRE of the store, or SM / ASM / Floor Manager / management. */
export async function canPostWalkins(staff: StaffUser, store: string) {
  if ((await creStoreOf(staff)) === store) return true;
  return (await merchStores(staff, [store])).includes(store);
}

export const conversion = (bills: number, walkins: number | null | undefined) => (walkins && walkins > 0 ? bills / walkins : null);

/** One press of the counter (+1 / −1). Returns the new total for the day. Repeats of the same clientId count once. */
export async function addWalkin(store: string, day: string, delta: 1 | -1, by: { id: string; name: string }, source: string, clientId: string | null) {
  const { data, error } = await supabaseAdmin.rpc("walkin_add", {
    p_store: store,
    p_day: day,
    p_delta: delta,
    p_by: by.id,
    p_name: by.name,
    p_source: source.slice(0, 20),
    p_client: clientId ? clientId.slice(0, 64) : null,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** A manual total (posted in the box) is also kept as one entry, so the hourly view adds up. */
export async function logManualWalkins(store: string, day: string, delta: number, by: { id: string; name: string }) {
  if (!delta) return;
  await supabaseAdmin.from("walkin_events").insert({ store, day, delta, by_id: by.id, by_name: by.name, source: "manual" });
}

/** Walk-ins per hour of the day (store time), from the counter presses. */
export async function hourlyWalkins(store: string, day: string): Promise<{ hour: number; count: number }[]> {
  const { data } = await supabaseAdmin.from("walkin_events").select("at, delta, source").eq("store", store).eq("day", day).limit(5000);
  const by = new Map<number, number>();
  for (const e of (data ?? []) as { at: string; delta: number; source: string }[]) {
    if (e.source === "manual") continue; // a typed total has no real time of arrival
    const h = new Date(new Date(e.at).getTime() + 330 * 60_000).getUTCHours();
    by.set(h, (by.get(h) ?? 0) + e.delta);
  }
  return [...by.entries()].map(([hour, count]) => ({ hour, count: Math.max(0, count) })).sort((a, b) => a.hour - b.hour);
}

/** Stores this person may count walk-ins for (CRE: own store; SM / ASM / management: their stores). */
export async function walkinStores(staff: StaffUser, allStores: string[]) {
  const cre = await creStoreOf(staff);
  const managed = await merchStores(staff, allStores);
  return [...new Set([...(cre ? [cre] : []), ...managed])];
}

/**
 * Walk-ins counted by the entrance camera: every crossing of the doorway line is a photo. With the AI
 * photo check (lib/camera-ai.ts), staff in uniform and people going out are left out, and a party
 * that came together counts once; crossings within groupSec seconds of each other are one walk-in.
 * Photos not checked yet count as one walk-in each. Null when the camera count is not set up.
 */
export async function cameraWalkins(
  store: string,
  day: string
): Promise<{ walkins: number; people: number; staff: number; pending: number; lastAt: string | null } | null> {
  const { loadCctv } = await import("@/lib/cctv");
  const { links, watch } = await loadCctv();
  const link = links.find((l) => l.store === store);
  if (!link || !link.channels.length || !watch.walkinCode) return null;
  const from = new Date(Date.parse(`${day}T00:00:00+05:30`)).toISOString();
  const to = new Date(Date.parse(`${day}T00:00:00+05:30`) + 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("cctv_events")
    .select("id, event_at, ai")
    .eq("store", store)
    .in("channel", link.channels)
    .gte("event_at", from)
    .lt("event_at", to)
    .filter("raw->sub_type", "cs", `[${watch.walkinCode}]`)
    .order("event_at")
    .limit(5000);
  type Ai = { people?: number; staff?: number; customers?: number; groups?: number; direction?: string } | null;
  const rows = (data ?? []) as { id: number; event_at: string; ai: Ai }[];
  // A manager's mark ("Not a customer — staff" / "This is a customer") overrides the AI.
  const { loadMarks } = await import("@/lib/camera-ai");
  const marks = await loadMarks(rows.map((r) => r.id)).catch(() => new Map<number, { verdict: string }>());
  let walkins = 0;
  let people = 0;
  let staff = 0;
  let pending = 0;
  let prev = -Infinity;
  let burst = 0;
  for (const r of rows) {
    const t = Date.parse(r.event_at);
    const mark = marks.get(r.id)?.verdict;
    // A photo the AI could not use (missing photo, other camera) is left out, not counted as waiting.
    if (!mark && r.ai && typeof r.ai.people !== "number") continue;
    const ai: Ai =
      mark === "staff"
        ? { people: 1, staff: 1, customers: 0, groups: 0, direction: "in" }
        : mark === "customer"
          ? { people: 1, staff: 0, customers: Math.max(1, r.ai?.customers ?? 1), groups: Math.max(1, r.ai?.groups ?? 1), direction: "in" }
          : r.ai && typeof r.ai.people === "number"
            ? r.ai
            : null;
    let w: number;
    if (!ai) {
      w = 1;
      pending++;
      people++;
    } else if (ai.direction === "out" || !ai.customers) {
      w = 0;
      if (ai.direction !== "out") staff += ai.staff ?? 0;
    } else {
      w = Math.max(1, ai.groups ?? 1);
      people += ai.customers;
      staff += ai.staff ?? 0;
    }
    if (t - prev > watch.groupSec * 1000) {
      walkins += burst;
      burst = w;
    } else burst = Math.max(burst, w);
    prev = t;
  }
  walkins += burst;
  return { walkins, people, staff, pending, lastAt: rows.length ? rows[rows.length - 1].event_at : null };
}
