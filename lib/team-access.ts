// Who may set shifts and targets for whom (Shifts, targets & transfers page). Server only.
//   - Admins and HR (HR Head, HR Executive): everyone; also the shift list and the Excel import.
//   - Transfers between stores: HR and the Super Admin only.
//   - Store Manager: the people of their own store (not themselves): shifts and targets.

import type { StaffUser } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { performanceAccess } from "@/lib/performance-access";

export type TeamScope = {
  allowed: boolean;
  /** null = every store. */
  stores: string[] | null;
  /** Shift list and Excel import. */
  manage: boolean;
  /** Transfers between stores: HR and the Super Admin only. */
  transfer: boolean;
  /** Delete a saved change. */
  canDelete: boolean;
  me: string;
};

const HR = ["hr_head", "hr_executive"];

export async function teamScope(staff: StaffUser): Promise<TeamScope> {
  const me = staff.userId;
  if (isAdmin(staff.role) || HR.includes(staff.role)) {
    return { allowed: true, stores: null, manage: true, transfer: staff.role === "super_admin" || HR.includes(staff.role), canDelete: staff.role === "super_admin" || staff.role === "hr_head", me };
  }
  const own = (staff.storeName ?? "").toUpperCase();
  if (own && (staff.role === "store_manager" || (await performanceAccess(staff)).group === "sm")) {
    return { allowed: true, stores: [own], manage: false, transfer: false, canDelete: false, me };
  }
  return { allowed: false, stores: [], manage: false, transfer: false, canDelete: false, me };
}

/** May this scope change this person (by their current store)? */
export function inScope(scope: TeamScope, personStore: string | null, personId: string) {
  if (!scope.allowed) return false;
  if (scope.stores === null) return true;
  if (personId === scope.me) return false;
  return !!personStore && scope.stores.includes(personStore.toUpperCase());
}
