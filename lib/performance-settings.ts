// Settings for the sales performance dashboard (Supabase app_settings). Server only.

import { supabaseAdmin } from "@/lib/supabase/server";
import { DEFAULT_PERFORMANCE_SETTINGS, type PerformanceSettings } from "@/lib/performance-rules";
import { DEFAULT_RULES, type IncentiveRule } from "@/lib/incentive-rules";

const KEY = "sales_performance";
const RULES_KEY = "incentive_rules";

export async function loadPerformanceSettings(): Promise<PerformanceSettings> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    const v = (data?.value ?? {}) as Partial<PerformanceSettings>;
    return {
      ...DEFAULT_PERFORMANCE_SETTINGS,
      ...v,
      storeTargets: { ...DEFAULT_PERFORMANCE_SETTINGS.storeTargets, ...(v.storeTargets ?? {}) },
      salespersonLinks: v.salespersonLinks ?? {},
      excludedStores: v.excludedStores ?? DEFAULT_PERFORMANCE_SETTINGS.excludedStores,
      ptPeople: v.ptPeople ?? {},
      groupLabels: v.groupLabels ?? {},
      customGroups: v.customGroups ?? [],
      incentiveStores: v.incentiveStores ?? {},
      salesPerSalary: Number(v.salesPerSalary) || 0,
    };
  } catch {
    return { ...DEFAULT_PERFORMANCE_SETTINGS };
  }
}

export async function savePerformanceSettings(change: Partial<PerformanceSettings>) {
  const current = await loadPerformanceSettings();
  const value = { ...current, ...change };
  const { error } = await supabaseAdmin.from("app_settings").upsert({ key: KEY, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  return value;
}

/** Incentive schemes (the policy defaults until something is changed in Settings). */
export async function loadIncentiveRules(): Promise<IncentiveRule[]> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", RULES_KEY).maybeSingle();
    const rules = (data?.value as { rules?: IncentiveRule[] } | null)?.rules;
    return Array.isArray(rules) && rules.length ? rules : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

export async function saveIncentiveRules(rules: IncentiveRule[]) {
  const { error } = await supabaseAdmin.from("app_settings").upsert({ key: RULES_KEY, value: { rules }, updated_at: new Date().toISOString() });
  if (error) throw error;
}
