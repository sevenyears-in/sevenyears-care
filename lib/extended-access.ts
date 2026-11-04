// Who handles extended warranty inspections (shared).

import { isCorporateStaff, sameStore, type Role } from "@/lib/roles";

export const EXTENSION_ROLES: Role[] = ["super_admin", "admin", "director", "service_head", "store_manager", "technician", "cre"];

export function canHandleExtensions(role: Role) {
  return EXTENSION_ROLES.includes(role) && role !== "director";
}

export function canSeeExtensions(role: Role) {
  return EXTENSION_ROLES.includes(role);
}

/** Store teams handle their own store; Corporate Office and the Service Head handle all stores. */
export function sameStoreOrCorporate(staff: { role: Role; storeName: string | null }, store: string | null) {
  return isCorporateStaff(staff) || staff.role === "service_head" || sameStore(staff.storeName, store);
}
