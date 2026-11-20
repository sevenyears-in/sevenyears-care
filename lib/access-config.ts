// Loads / saves the Roles & Access settings (server only).
import { supabaseAdmin } from "@/lib/supabase/server";
import { isRole, type Role } from "@/lib/roles";
import { defaultAccess, SECTION_KEYS, type AccessConfig, type CustomRole, type RoleAccess, type Section } from "@/lib/access";

const KEY = "role_access";
let cached: { at: number; value: AccessConfig } | null = null;

function cleanSections(v: unknown): Section[] {
  return SECTION_KEYS.filter((k) => Array.isArray(v) && v.includes(k));
}

const cleanGroup = (v: unknown) => (typeof v === "string" && /^[a-z][a-z0-9_]{0,40}$/.test(v) ? v : null);

/**
 * Version 2 added "Sales & Performance" and "Stock & Merchandise" (before, they followed the
 * role): settings saved earlier get them as the role had them, so nobody loses access.
 */
function withNewSections(sections: Section[], role: Role): Section[] {
  const d = defaultAccess(role).sections;
  return SECTION_KEYS.filter((k) => sections.includes(k) || ((k === "performance" || k === "stock") && d.includes(k)));
}

export function cleanAccessConfig(raw: unknown): AccessConfig {
  const r = (raw ?? {}) as { builtin?: Record<string, RoleAccess>; custom?: CustomRole[]; version?: number };
  const old = Number(r.version ?? 1) < 2;
  const builtin: AccessConfig["builtin"] = {};
  for (const [role, a] of Object.entries(r.builtin ?? {})) {
    if (isRole(role) && role !== "super_admin") {
      const sections = cleanSections(a?.sections);
      builtin[role] = { sections: old ? withNewSections(sections, role) : sections, allStores: Boolean(a?.allStores), group: cleanGroup(a?.group) };
    }
  }
  const custom = (Array.isArray(r.custom) ? r.custom : [])
    .filter((c) => c && typeof c.id === "string" && typeof c.name === "string" && isRole(c.baseRole) && c.baseRole !== "super_admin")
    .map((c) => ({
      id: c.id.slice(0, 40),
      name: c.name.trim().slice(0, 40),
      baseRole: c.baseRole,
      sections: old ? withNewSections(cleanSections(c.sections), c.baseRole) : cleanSections(c.sections),
      allStores: Boolean(c.allStores),
      group: cleanGroup(c.group),
    }))
    .filter((c) => c.name);
  return { version: 2, builtin, custom };
}

export async function loadAccessConfig(): Promise<AccessConfig> {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  const value = cleanAccessConfig(data?.value);
  cached = { at: Date.now(), value };
  return value;
}

export async function saveAccessConfig(config: AccessConfig) {
  const value = cleanAccessConfig(config);
  const { error } = await supabaseAdmin.from("app_settings").upsert({ key: KEY, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  cached = { at: Date.now(), value };
  return value;
}
