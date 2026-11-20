// Roles & Access: which sections each role (built-in or custom) can open,
// plus extra sections given to one person. Shared by server and client code.
//
// Each role has: the work & alerts it handles (who gets a complaint, escalations, approvals —
// one of the built-in roles' work, or none), the sections it can open, own store or all stores,
// and a default incentive group.

import { canSeeComplaints, canSeeService, isCorporateStaff, ROLE_LABELS, type Role } from "@/lib/roles";
import { FEEDBACK_ROLES } from "@/lib/feedback-access";
import { EXTENSION_ROLES } from "@/lib/extended-access";

export const SECTIONS = [
  { key: "register", label: "Register Warranty" },
  { key: "warranties", label: "Warranties" },
  { key: "service", label: "Service Requests" },
  { key: "complaints", label: "Complaints" },
  { key: "explanations", label: "Explanations" },
  { key: "feedback", label: "Customer Feedback" },
  { key: "extended", label: "Extended Warranty" },
  { key: "performance", label: "Sales & Performance" },
  { key: "stock", label: "Stock & Merchandise" },
] as const;

export type Section = (typeof SECTIONS)[number]["key"];
export const SECTION_KEYS = SECTIONS.map((s) => s.key) as Section[];

export type RoleAccess = {
  sections: Section[];
  allStores: boolean;
  /** Default incentive group of people with this role (a person's own choice in Performance wins). */
  group?: string | null;
};
export type CustomRole = RoleAccess & { id: string; name: string; baseRole: Role };
export type AccessConfig = {
  version?: number;
  builtin: Partial<Record<Role, RoleAccess>>;
  custom: CustomRole[];
};

export const EMPTY_ACCESS_CONFIG: AccessConfig = { version: 2, builtin: {}, custom: [] };

/** What each built-in role could open before Roles & Access existed. */
export function defaultAccess(role: Role, storeName: string | null = null): RoleAccess {
  // "Own performance only": no sections at all.
  if (role === "employee") return { sections: [], allStores: false };
  const sections: Section[] = ["register", "warranties", "explanations"];
  if (canSeeService(role)) sections.push("service");
  if (canSeeComplaints(role)) sections.push("complaints");
  if (FEEDBACK_ROLES.includes(role)) sections.push("feedback");
  if (EXTENSION_ROLES.includes(role)) sections.push("extended");
  // Store sales dashboards and stock pages: management and the store's managers.
  if (["admin", "director", "operations_manager", "store_manager", "floor_incharge"].includes(role)) sections.push("performance", "stock");
  return {
    sections: SECTION_KEYS.filter((k) => sections.includes(k)),
    allStores: isCorporateStaff({ role, storeName }),
  };
}

export function roleAccess(config: AccessConfig, role: Role): RoleAccess {
  const saved = config.builtin[role];
  return saved
    ? { sections: SECTION_KEYS.filter((k) => saved.sections.includes(k)), allStores: Boolean(saved.allStores), group: saved.group ?? null }
    : defaultAccess(role);
}

export type StaffAccess = {
  sections: Section[];
  /** Sees every store (in addition to the normal rules of the built-in role). */
  allStores: boolean;
  roleLabel: string;
  customRoleId: string | null;
  extraSections: Section[];
  /** Default incentive group of the role (null: worked out from the role). */
  group: string | null;
};

/** Final access of one staff member. Super Admin always has everything. */
export function resolveAccess(
  config: AccessConfig,
  person: { role: Role; storeName: string | null; customRoleId?: string | null; extraSections?: string[] | null }
): StaffAccess {
  const extra = SECTION_KEYS.filter((k) => (person.extraSections ?? []).includes(k));
  if (person.role === "super_admin") {
    return { sections: [...SECTION_KEYS], allStores: true, roleLabel: ROLE_LABELS.super_admin, customRoleId: null, extraSections: extra, group: null };
  }
  const custom = person.customRoleId ? config.custom.find((c) => c.id === person.customRoleId) : undefined;
  const base = custom ?? roleAccess(config, person.role);
  const sections = SECTION_KEYS.filter((k) => base.sections.includes(k) || extra.includes(k));
  return {
    sections,
    allStores: base.allStores || isCorporateStaff(person),
    roleLabel: custom ? custom.name : ROLE_LABELS[person.role],
    customRoleId: custom?.id ?? null,
    extraSections: extra,
    group: base.group ?? null,
  };
}

/** What "work & alerts" a built-in role brings, in plain words. */
export function workLabel(role: Role): string {
  return role === "employee" ? "None — own performance only" : `${ROLE_LABELS[role]}'s work`;
}

export function hasSection(staff: { role: Role; access?: StaffAccess }, section: Section) {
  if (staff.role === "super_admin") return true;
  return staff.access ? staff.access.sections.includes(section) : defaultAccess(staff.role).sections.includes(section);
}
