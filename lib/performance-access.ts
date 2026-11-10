// Who sees the sales performance pages. Server only.
//   - Own page: people in an incentive group (not "Not in incentive").
//   - Store pages: admins, operations, directors (their stores) and store / assistant store managers (own store).

import type { StaffUser } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase/server";
import { defaultGroup, isGroup, type IncentiveGroup } from "@/lib/performance-rules";

export type PerformanceAccess = { eligible: boolean; group: IncentiveGroup; teamAll: boolean; teamStores: string[] };

export async function performanceAccess(staff: StaffUser): Promise<PerformanceAccess> {
  const { data } = await supabaseAdmin.from("staff_users").select("incentive_group").eq("id", staff.id).maybeSingle();
  const group = isGroup(data?.incentive_group) ? (data!.incentive_group as IncentiveGroup) : defaultGroup(staff.role, staff.access.roleLabel);
  const own = (staff.storeName ?? "").toUpperCase();
  let teamAll = false;
  let teamStores: string[] = [];
  if (isAdmin(staff.role) || staff.role === "operations_manager") teamAll = true;
  else if (staff.role === "director") {
    if (staff.directorStores.length) teamStores = staff.directorStores.map((s) => s.toUpperCase());
    else teamAll = true;
  } else if (group === "sm" || group === "asm" || staff.role === "store_manager") teamStores = own ? [own] : [];
  return { eligible: group !== "none", group, teamAll, teamStores };
}

/** Name of the menu item, or null when the person has nothing to see. */
export function performanceMenuLabel(a: PerformanceAccess) {
  if (a.eligible) return "My Performance";
  if (a.teamAll || a.teamStores.length) return "Sales Performance";
  return null;
}
