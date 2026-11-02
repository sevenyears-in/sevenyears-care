// Staff roles and who can see / do what.
// Shared by server and client code (no server-only imports here).

export const ROLES = [
  "super_admin",
  "admin",
  "store_manager",
  "service_head",
  "technician",
  "hr_head",
  "operations_manager",
  "cre",
  "csa",
  "staff", // old "Store Staff" — kept only so existing accounts still work
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  store_manager: "Store Manager",
  service_head: "Service Head",
  technician: "Technician",
  hr_head: "HR Head",
  operations_manager: "Operations Manager",
  cre: "CRE",
  csa: "CSA",
  staff: "Store Staff (old)",
};

/** Roles that can be given to new / existing staff (the old "Store Staff" is not offered). */
export const ASSIGNABLE_ROLES: Role[] = ROLES.filter((r) => r !== "staff");

export const ROLE_HELP: Record<Role, string> = {
  super_admin: "Full access to everything, including Zoho POS connection.",
  admin: "Manages warranty categories and staff. Sees all requests.",
  store_manager: "Service requests and complaints of their store.",
  service_head: "All service requests; assigns technicians, approves replacements.",
  technician: "Service requests of their store and jobs assigned to them.",
  hr_head: "All complaints (staff behaviour complaints are led by HR).",
  operations_manager: "All complaints; escalation level 2.",
  cre: "Customer Relationship Executive: all complaints (web, WhatsApp, Aira chatbot) and service requests of every store; handles complaints, follows up service requests.",
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
export const SERVICE_ROLES: Role[] = ["super_admin", "admin", "service_head", "store_manager", "technician", "cre", "csa"];

/** Roles that work on complaints. */
export const COMPLAINT_ROLES: Role[] = ["super_admin", "admin", "hr_head", "operations_manager", "store_manager", "cre", "csa"];

/** Roles that only see tickets of their own store. */
export const STORE_SCOPED_ROLES: Role[] = ["store_manager", "technician", "csa"];

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
