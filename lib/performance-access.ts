// Who sees the sales performance pages. Server only.
//   - Own page: people in an incentive group (not "Not in incentive").
//   - Store pages: admins, operations, directors (their stores) and store / assistant store managers (own store).

import type { StaffUser } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { hasSection } from "@/lib/access";
import { supabaseAdmin } from "@/lib/supabase/server";
import { defaultGroup, isGroup, type IncentiveGroup } from "@/lib/performance-rules";
import { loadPerformanceSettings } from "@/lib/performance-settings";

export type PerformanceAccess = { eligible: boolean; group: IncentiveGroup; teamAll: boolean; teamStores: string[] };

export async function performanceAccess(staff: StaffUser): Promise<PerformanceAccess> {
  const [{ data }, settings] = await Promise.all([
    supabaseAdmin.from("staff_users").select("incentive_group").eq("id", staff.id).maybeSingle(),
    loadPerformanceSettings(),
  ]);
  // The person's own group (Performance settings), else their role's default group, else from the role.
  const group = isGroup(data?.incentive_group)
    ? (data!.incentive_group as IncentiveGroup)
    : isGroup(staff.access.group)
      ? (staff.access.group as IncentiveGroup)
      : defaultGroup(staff.role, staff.access.roleLabel, settings.asmIsFm);
  const own = (staff.storeName ?? "").toUpperCase();
  let teamAll = false;
  let teamStores: string[] = [];
  // Store dashboards: roles with "Sales & Performance" (Roles & Access) — all stores or their own.
  if (isAdmin(staff.role) || hasSection(staff, "performance")) {
    if (staff.role === "director" && staff.directorStores.length) teamStores = staff.directorStores.map((s) => s.toUpperCase());
    else if (isAdmin(staff.role) || staff.access.allStores) teamAll = true;
    else teamStores = own ? [own] : [];
  } else if (group === "sm" || group === "asm") teamStores = own ? [own] : [];
  return { eligible: group !== "none", group, teamAll, teamStores };
}

/** Name of the menu item, or null when the person has nothing to see. */
export function performanceMenuLabel(a: PerformanceAccess) {
  if (a.eligible) return "My Performance";
  if (a.teamAll || a.teamStores.length) return "My Performance";
  return null;
}
