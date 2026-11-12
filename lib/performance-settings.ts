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
      noTargetGroups: Array.isArray(v.noTargetGroups) ? v.noTargetGroups : DEFAULT_PERFORMANCE_SETTINGS.noTargetGroups,
      poolOnlyGroups: Array.isArray(v.poolOnlyGroups) ? v.poolOnlyGroups : DEFAULT_PERFORMANCE_SETTINGS.poolOnlyGroups,
      asmIsFm: v.asmIsFm === undefined ? true : Boolean(v.asmIsFm),
      shifts: Array.isArray(v.shifts) && v.shifts.length ? v.shifts : DEFAULT_PERFORMANCE_SETTINGS.shifts,
      lateGraceMinutes: Number.isFinite(Number(v.lateGraceMinutes)) && v.lateGraceMinutes !== undefined ? Number(v.lateGraceMinutes) : DEFAULT_PERFORMANCE_SETTINGS.lateGraceMinutes,
      personShifts: v.personShifts ?? {},
      storeHours: v.storeHours && typeof v.storeHours === "object" && Object.keys(v.storeHours).length ? v.storeHours : DEFAULT_PERFORMANCE_SETTINGS.storeHours,
      specialDays: Array.isArray(v.specialDays) ? v.specialDays.map(String) : [],
      leanBelowPct: Number.isFinite(Number(v.leanBelowPct)) && v.leanBelowPct !== undefined ? Number(v.leanBelowPct) : DEFAULT_PERFORMANCE_SETTINGS.leanBelowPct,
      shortDayPct: Number.isFinite(Number(v.shortDayPct)) && v.shortDayPct !== undefined ? Number(v.shortDayPct) : DEFAULT_PERFORMANCE_SETTINGS.shortDayPct,
      alertTimes: Array.isArray(v.alertTimes) && v.alertTimes.length ? v.alertTimes.map(String) : DEFAULT_PERFORMANCE_SETTINGS.alertTimes,
      velocityDays: Number(v.velocityDays) >= 7 ? Number(v.velocityDays) : DEFAULT_PERFORMANCE_SETTINGS.velocityDays,
      reorderToDays: Number(v.reorderToDays) >= 7 ? Number(v.reorderToDays) : DEFAULT_PERFORMANCE_SETTINGS.reorderToDays,
    };
  } catch {
    return { ...DEFAULT_PERFORMANCE_SETTINGS };
  }
}

/** Name shown for the ASM group: "ASM / Floor Manager" while they are one role (unless renamed). */
export function withRoleNames(s: PerformanceSettings): PerformanceSettings {
  if (s.asmIsFm && !s.groupLabels.asm) return { ...s, groupLabels: { ...s.groupLabels, asm: "ASM / Floor Manager" } };
  return s;
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
