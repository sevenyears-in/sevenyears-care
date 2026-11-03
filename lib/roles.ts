// Staff roles and who can see / do what.
// Shared by server and client code (no server-only imports here).

export const ROLES = [
  "super_admin",
  "admin",
  "director",
  "store_manager",
  "service_head",
  "technician",
  "hr_head",
  "hr_executive",
  "operations_manager",
  "cre",
  "floor_incharge",
  "csa",
  "staff", // old "Store Staff" — kept only so existing accounts still work
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  director: "Director",
  store_manager: "Store Manager",
  service_head: "Service Head",
  technician: "Technician",
  hr_head: "HR Head",
  hr_executive: "HR Executive",
  operations_manager: "Operations Manager",
  cre: "CRE",
  floor_incharge: "Floor Incharge",
  csa: "CSA",
  staff: "Store Staff (old)",
};

/** Roles that can be given to new / existing staff (the old "Store Staff" is not offered). */
export const ASSIGNABLE_ROLES: Role[] = ROLES.filter((r) => r !== "staff");

export const ROLE_HELP: Record<Role, string> = {
  super_admin: "Full access to everything, including Zoho POS connection.",
  admin: "Manages warranty categories and staff. Sees all requests.",
  director: "Corporate office. Sees every store (store-wise dashboard), asks staff for explanations, gets every escalation of the stores they look after. Cannot change settings.",
  store_manager: "Service requests and complaints of their store; owns delivery / service complaints.",
  service_head: "All service requests of every store; assigns technicians, approves replacements; delivery / warranty-service complaints.",
  technician: "Service requests of their store and jobs assigned to them.",
  hr_executive: "Handles staff behaviour complaints with the HR Head (confidential).",
  hr_head: "All complaints (staff behaviour complaints are led by HR).",
  operations_manager: "All complaints; escalation level 2.",
  cre: "Customer Relationship Executive: owns product, billing and other complaints of their store (all stores if at CORPORATE OFFICE); follows up service requests.",
  floor_incharge: "Runs the shop floor: sees service requests and complaints of their store and follows them up.",
  csa: "Customer Service Associate: registers warranties and follows up service requests and complaints of their store.",
  staff: "Old role — registers warranties only. Change to CSA.",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function asRole(value: unknown): Role {
  return isRole(value) ? value : "csa";
}

/** Super Admin or Admin: categories, staff users, every ticket. */
export function isAdmin(role: Role) {
  return role === "super_admin" || role === "admin";
}

export function isSuperAdmin(role: Role) {
  return role === "super_admin";
}

/** Roles that work on service requests. */
export const SERVICE_ROLES: Role[] = ["super_admin", "admin", "director", "service_head", "store_manager", "technician", "cre", "floor_incharge", "csa"];

/** Roles that work on complaints. */
export const COMPLAINT_ROLES: Role[] = ["super_admin", "admin", "director", "hr_head", "hr_executive", "operations_manager", "service_head", "store_manager", "cre", "floor_incharge", "csa"];

/** Roles that only see tickets of their own store. */
export const STORE_SCOPED_ROLES: Role[] = ["store_manager", "technician", "floor_incharge", "csa"];

/** Sees every store and every request, but changes nothing. */
export function isDirector(role: Role) {
  return role === "director";
}

export function canSeeService(role: Role) {
  return SERVICE_ROLES.includes(role);
}

export function canSeeComplaints(role: Role) {
  return COMPLAINT_ROLES.includes(role);
}

export function sameStore(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export const CORPORATE_OFFICE_NAME = "CORPORATE OFFICE";

/**
 * Corporate staff see every store (Super Admin, Admin, Directors and anyone whose
 * store is CORPORATE OFFICE). Everyone else sees their own store only.
 */
export function isCorporateStaff(staff: { role: Role; storeName: string | null }) {
  return (
    isAdmin(staff.role) ||
    staff.role === "director" ||
    sameStore(staff.storeName, CORPORATE_OFFICE_NAME)
  );
}

/** Who may see staff behaviour complaints (confidential HR workflow). */
export const STAFF_COMPLAINT_ROLES: Role[] = ["super_admin", "admin", "director", "hr_head", "hr_executive", "store_manager"];
