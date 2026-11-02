// Default technician per store (server only).
// Some stores (e.g. Vadakara) have no separate technician: the Service Head
// does the technician work there. New service requests from such a store are
// given straight to the person chosen here, so they appear under "Assigned to me".
// Kept in Supabase app_settings "store_technicians": { "<store lower>": { storeName, staffId } }.

import { supabaseAdmin } from "@/lib/supabase/server";
import { sameStore } from "@/lib/roles";

const KEY = "store_technicians";

export type StoreTechnicianMap = Record<string, { storeName: string; staffId: string }>;

export async function loadStoreTechnicians(): Promise<StoreTechnicianMap> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    return (data?.value as StoreTechnicianMap) ?? {};
  } catch {
    return {};
  }
}

export async function saveStoreTechnicians(value: StoreTechnicianMap) {
  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ key: KEY, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** The active technician / Service Head who should get new requests of this store, if one is set. */
export async function defaultTechnicianFor(storeName: string | null) {
  if (!storeName) return null;
  const map = await loadStoreTechnicians();
  const entry = Object.values(map).find((e) => sameStore(e.storeName, storeName));
  if (!entry) return null;

  const { data } = await supabaseAdmin
    .from("staff_users")
    .select("id, full_name, role, is_active")
    .eq("id", entry.staffId)
    .maybeSingle();

  if (!data || !data.is_active || !["technician", "service_head"].includes(String(data.role))) return null;
  return { id: String(data.id), fullName: String(data.full_name), role: String(data.role) };
}
