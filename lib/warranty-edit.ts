// Who can edit a warranty (server only).
// Super Admin: everything. Store Manager: their own store's warranties (customer
// and product details), unless the Super Admin has switched this off for them.

import { supabaseAdmin } from "@/lib/supabase/server";
import { sameStore, type Role } from "@/lib/roles";

export type EditLevel = "full" | "store" | null;

export async function warrantyEditLevel(
  staff: { id: string; role: Role; storeName: string | null },
  warrantyStore: string | null
): Promise<EditLevel> {
  if (staff.role === "super_admin") return "full";
  if (staff.role !== "store_manager" || !sameStore(staff.storeName, warrantyStore)) return null;
  const { data, error } = await supabaseAdmin.from("staff_users").select("can_edit_warranties").eq("id", staff.id).maybeSingle();
  if (error) return null; // database not updated yet
  return data?.can_edit_warranties === false ? null : "store";
}
