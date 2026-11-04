// Store list — taken from Zoho POS so names match the bills exactly.
// A new store with no Zoho bill yet can be added by hand on the Zoho POS page;
// once Zoho lists it, the Zoho entry is used.
// Server only. The list is kept in Supabase (app_settings "zoho_stores") and
// refreshed from Zoho automatically every 15 minutes, so a store newly created
// in Zoho POS shows up here without any work.

import { supabaseAdmin } from "@/lib/supabase/server";
import { fetchZohoStores, zohoConfigured, type ZohoStore } from "@/lib/zoho";

export const CORPORATE_OFFICE = "CORPORATE OFFICE";

const CACHE_KEY = "zoho_stores";
const REFRESH_MS = 15 * 60 * 1000;

export type StoreOption = { name: string; code: string | null; manual?: boolean };

// ------------------------------------------------------------------
// Stores added by hand (a new store that has no Zoho bill yet)
// ------------------------------------------------------------------

const MANUAL_KEY = "manual_stores";
type ManualStore = { name: string; addedAt: string; addedBy: string | null };

export async function loadManualStores(): Promise<ManualStore[]> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", MANUAL_KEY).maybeSingle();
    const list = (data?.value as { stores?: ManualStore[] } | null)?.stores;
    return Array.isArray(list) ? list.filter((s) => s && typeof s.name === "string" && s.name.trim()) : [];
  } catch {
    return [];
  }
}

async function saveManualStores(stores: ManualStore[]) {
  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ key: MANUAL_KEY, value: { stores }, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export function cleanStoreName(value: string) {
  return value.replace(/\s+/g, " ").trim().toUpperCase().slice(0, 80);
}

export async function addManualStore(name: string, addedBy: string | null) {
  const clean = cleanStoreName(name);
  if (clean.length < 3) return { ok: false as const, error: "Type the store name (at least 3 letters)." };
  if (clean.toLowerCase() === CORPORATE_OFFICE.toLowerCase()) {
    return { ok: false as const, error: "CORPORATE OFFICE is always available." };
  }
  const current = await getStores();
  if (matchStore(current.stores, clean)) return { ok: false as const, error: `${clean} is already in the list.` };
  const list = await loadManualStores();
  await saveManualStores([...list, { name: clean, addedAt: new Date().toISOString(), addedBy }]);
  return { ok: true as const, name: clean };
}

export async function removeManualStore(name: string) {
  const wanted = name.trim().toLowerCase();
  const list = await loadManualStores();
  await saveManualStores(list.filter((s) => s.name.trim().toLowerCase() !== wanted));
}

/** Zoho stores first; hand-added stores that Zoho doesn't list yet are added after them. */
async function withManual(stores: StoreOption[]): Promise<StoreOption[]> {
  const manual = await loadManualStores();
  const known = new Set(stores.map((s) => s.name.trim().toLowerCase()));
  const extra = manual
    .filter((m) => !known.has(m.name.trim().toLowerCase()))
    .map((m) => ({ name: m.name, code: null, manual: true }));
  return [...stores, ...extra].sort((a, b) => a.name.localeCompare(b.name));
}

type Cache = { fetchedAt: string; stores: ZohoStore[]; lastError?: string | null };

async function readCache(): Promise<Cache | null> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", CACHE_KEY).maybeSingle();
    const value = data?.value as Cache | undefined;
    return value && Array.isArray(value.stores) ? value : null;
  } catch {
    return null;
  }
}

async function writeCache(value: Cache) {
  try {
    await supabaseAdmin
      .from("app_settings")
      .upsert({ key: CACHE_KEY, value, updated_at: new Date().toISOString() });
  } catch (error) {
    console.error("Saving store list failed:", error);
  }
}

let refreshing: Promise<unknown> | null = null;

function refreshInBackground(cache: Cache) {
  if (!refreshing) {
    refreshing = refreshFromZoho(cache)
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function refreshFromZoho(cache: Cache | null) {
  try {
    const stores = await fetchZohoStores();
    const fetchedAt = new Date().toISOString();
    await writeCache({ fetchedAt, stores, lastError: null });
    return { stores, fetchedAt, error: null as string | null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("Zoho store list refresh failed:", error);
    // Keep the last good list; try again in a few minutes.
    await writeCache({
      fetchedAt: cache?.fetchedAt ?? new Date(Date.now() - REFRESH_MS + 5 * 60 * 1000).toISOString(),
      stores: cache?.stores ?? [],
      lastError: error,
    });
    return { stores: cache?.stores ?? [], fetchedAt: cache?.fetchedAt ?? null, error };
  }
}

/** Old stores table — used only until Zoho POS is connected. */
async function legacyStores(): Promise<ZohoStore[]> {
  try {
    const { data } = await supabaseAdmin
      .from("stores")
      .select("id, store_name, is_active")
      .order("store_name");
    return (data ?? [])
      .filter((s) => s.store_name)
      .map((s) => ({ id: String(s.id), name: String(s.store_name), code: null, active: s.is_active !== false }));
  } catch {
    return [];
  }
}

export type StoreList = {
  stores: StoreOption[];
  source: "zoho" | "legacy";
  fetchedAt: string | null;
  error: string | null;
};

/** Active stores from Zoho POS (refreshed every 15 minutes, or now when force = true). */
export async function getStores(force = false): Promise<StoreList> {
  if (!(await zohoConfigured())) {
    const legacy = await legacyStores();
    return {
      stores: await withManual(legacy.filter((s) => s.active).map(({ name, code }) => ({ name, code }))),
      source: "legacy",
      fetchedAt: null,
      error: null,
    };
  }

  const cache = await readCache();
  const fresh = cache && Date.now() - new Date(cache.fetchedAt).getTime() < REFRESH_MS;

  let stores = cache?.stores ?? [];
  let fetchedAt = cache?.fetchedAt ?? null;
  let error: string | null = cache?.lastError ?? null;

  if (force || !cache) {
    // Asked to refresh now (Zoho POS page), or nothing saved yet: wait for Zoho.
    const result = await refreshFromZoho(cache);
    stores = result.stores;
    fetchedAt = result.fetchedAt;
    error = result.error;
  } else if (!fresh) {
    // Use the saved list straight away and refresh it in the background,
    // so nobody waits for Zoho POS (reading it can take several seconds).
    void refreshInBackground(cache);
  }

  return {
    stores: await withManual(stores.filter((s) => s.active).map(({ name, code }) => ({ name, code }))),
    source: "zoho",
    fetchedAt,
    error,
  };
}

/** The store's exact Zoho name for a typed/selected value, or null if it isn't a Zoho store. */
export function matchStore(stores: StoreOption[], value: string) {
  const wanted = value.trim().toLowerCase();
  return stores.find((s) => s.name.trim().toLowerCase() === wanted) ?? null;
}
