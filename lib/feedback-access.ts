// Who can see customer feedback (shared by the report page and its API).

import { isAdmin, isCorporateStaff, type Role } from "@/lib/roles";

export const FEEDBACK_ROLES: Role[] = [
  "super_admin",
  "admin",
  "director",
  "store_manager",
  "service_head",
  "hr_head",
  "hr_executive",
  "cre",
  "operations_manager",
];

/** Staff behaviour complaint feedback stays within HR (plus Directors and admins). */
export const CONFIDENTIAL_FEEDBACK_ROLES: Role[] = ["super_admin", "admin", "director", "hr_head", "hr_executive"];

export function canSeeFeedback(role: Role) {
  return FEEDBACK_ROLES.includes(role);
}

export function feedbackScope(staff: { role: Role; storeName: string | null; access?: { allStores: boolean } }) {
  return {
    allStores: isCorporateStaff(staff) || staff.role === "service_head" || staff.role === "hr_head" || Boolean(staff.access?.allStores),
    confidential: CONFIDENTIAL_FEEDBACK_ROLES.includes(staff.role),
    onlyConfidential: staff.role === "hr_executive",
    canMarkDone: isAdmin(staff.role) || staff.role !== "director",
  };
}

/** Who may publish, unpublish, approve or reject website reviews. */
export function canManageReviews(role: Role) {
  return isAdmin(role) || role === "director";
}
