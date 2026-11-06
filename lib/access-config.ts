// Loads / saves the Roles & Access settings (server only).
import { supabaseAdmin } from "@/lib/supabase/server";
import { isRole } from "@/lib/roles";
import { SECTION_KEYS, type AccessConfig, type CustomRole, type RoleAccess, type Section } from "@/lib/access";

const KEY = "role_access";
let cached: { at: number; value: AccessConfig } | null = null;

function cleanSections(v: unknown): Section[] {
  return SECTION_KEYS.filter((k) => Array.isArray(v) && v.includes(k));
}

export function cleanAccessConfig(raw: unknown): AccessConfig {
  const r = (raw ?? {}) as { builtin?: Record<string, RoleAccess>; custom?: CustomRole[] };
  const builtin: AccessConfig["builtin"] = {};
  for (const [role, a] of Object.entries(r.builtin ?? {})) {
    if (isRole(role) && role !== "super_admin") builtin[role] = { sections: cleanSections(a?.sections), allStores: Boolean(a?.allStores) };
  }
  const custom = (Array.isArray(r.custom) ? r.custom : [])
    .filter((c) => c && typeof c.id === "string" && typeof c.name === "string" && isRole(c.baseRole) && c.baseRole !== "super_admin")
    .map((c) => ({
      id: c.id.slice(0, 40),
      name: c.name.trim().slice(0, 40),
      baseRole: c.baseRole,
      sections: cleanSections(c.sections),
      allStores: Boolean(c.allStores),
    }))
    .filter((c) => c.name);
  return { builtin, custom };
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
