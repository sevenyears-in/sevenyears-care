// Settings for the sales performance dashboard (Supabase app_settings "sales_performance").
// Server only.

import { supabaseAdmin } from "@/lib/supabase/server";
import { DEFAULT_PERFORMANCE_SETTINGS, type PerformanceSettings } from "@/lib/performance-rules";

const KEY = "sales_performance";

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
