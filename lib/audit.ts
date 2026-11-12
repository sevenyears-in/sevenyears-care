// Change history of business settings (server only): who changed what, when, before and after.

import { supabaseAdmin } from "@/lib/supabase/server";
import type { StaffUser } from "@/lib/auth";

type Json = Record<string, unknown>;

/** Only the top-level keys that changed, before and after. */
export function changedKeys(before: Json, after: Json) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return { before: Object.fromEntries(keys.map((k) => [k, before[k] ?? null])), after: Object.fromEntries(keys.map((k) => [k, after[k] ?? null])), keys };
}

export async function logAudit(staff: Pick<StaffUser, "userId" | "fullName">, area: string, action: string, before: unknown, after: unknown) {
  try {
    await supabaseAdmin.from("settings_audit").insert({ user_id: staff.userId, user_name: staff.fullName, area, action, before: before ?? null, after: after ?? null });
  } catch (error) {
    console.error("Audit log failed:", error);
  }
}

export type AuditRow = { id: number; at: string; user_name: string | null; area: string; action: string; before: Json | null; after: Json | null };

export async function loadAudit(area?: string, limit = 100): Promise<AuditRow[]> {
  let q = supabaseAdmin.from("settings_audit").select("id, at, user_name, area, action, before, after").order("at", { ascending: false }).limit(limit);
  if (area) q = q.eq("area", area);
  const { data } = await q;
  return (data ?? []) as AuditRow[];
}
