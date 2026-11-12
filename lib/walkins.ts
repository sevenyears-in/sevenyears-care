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
