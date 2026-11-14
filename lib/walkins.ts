// Walk-ins per store and day (server only), posted by the store's CRE (Cashier / CRE group),
// or corrected by the Store Manager / ASM / Floor Manager or management. One running total for the day:
// the CRE updates it as the day goes on; every change is kept in the change history.
// Conversion = bills ÷ walk-ins.

import { supabaseAdmin } from "@/lib/supabase/server";
import type { StaffUser } from "@/lib/auth";
import { loadPerformanceSettings } from "@/lib/performance-settings";
import { loadStaffForPerformance } from "@/lib/performance";
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
  const s = await loadPerformanceSettings();
  const rows = await loadStaffForPerformance(s.asmIsFm);
  const me = rows.find((r) => r.id === staff.id);
  return me && me.group === "cashier_cre" && me.store ? me.store : null;
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
