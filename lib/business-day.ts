// Business-day rules (client-safe): when a trading day is closed and its data complete.
//
// A day is:
//   "live"        — today, before closing time (+30 min): shown as live sales only.
//   "provisional" — closed, but no copy from Zoho has run after closing yet.
//   "special"     — a holiday / special trading day set in Settings (left out of comparisons).
//   "closed"      — closed and copied after closing: used for peak / lean days and averages.

import type { PerformanceSettings } from "@/lib/performance-rules";
import { timeToMinutes } from "@/lib/performance-rules";

export type DayState = "live" | "provisional" | "special" | "closed";

/** India time now: date and minutes after midnight. */
export function istNow(at = new Date()) {
  const t = new Date(at.getTime() + 5.5 * 3_600_000);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

export const hoursOf = (s: Pick<PerformanceSettings, "storeHours">, store: string) => s.storeHours[store] ?? s.storeHours["*"] ?? { open: "09:30", close: "22:00" };

/** Closing moment of a store's day (UTC ms), with 30 minutes for the last bills to reach Zoho. */
export function closingAt(s: Pick<PerformanceSettings, "storeHours">, store: string, date: string) {
  const close = timeToMinutes(hoursOf(s, store).close) || 22 * 60;
  return Date.parse(`${date}T00:00:00Z`) - 5.5 * 3_600_000 + (close + 30) * 60_000;
}

export function isSpecialDay(s: Pick<PerformanceSettings, "specialDays">, store: string, date: string) {
  return s.specialDays.includes(date) || s.specialDays.includes(`${store}:${date}`);
}

export function dayState(s: Pick<PerformanceSettings, "storeHours" | "specialDays">, store: string, date: string, lastSyncAt: string | null, now = new Date()): DayState {
  if (isSpecialDay(s, store, date)) return "special";
  const closes = closingAt(s, store, date);
  if (now.getTime() < closes) return "live";
  const synced = lastSyncAt ? Date.parse(lastSyncAt) : 0;
  return synced >= closes ? "closed" : "provisional";
}

/**
 * Peak and lean days among closed days.
 * Lean = the lowest closed days whose sales are below `leanBelowPct` of the median day.
 * Days below `shortDayPct` of the median are "short" (possibly closed early / incomplete), not lean.
 */
export function peakLeanDays<T extends { date: string; net: number; bills: number }>(
  days: T[],
  state: (date: string) => DayState,
  s: Pick<PerformanceSettings, "leanBelowPct" | "shortDayPct">,
  count = 3
) {
  const closed = days.filter((d) => d.bills > 0 && state(d.date) === "closed");
  const sorted = [...closed].map((d) => d.net).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const short = closed.filter((d) => median > 0 && d.net < median * s.shortDayPct);
  const normal = closed.filter((d) => !short.includes(d));
  const ranked = [...normal].sort((a, b) => b.net - a.net);
  const peak = ranked.slice(0, count);
  const lean = ranked.length > 5 ? ranked.filter((d) => d.net < median * s.leanBelowPct).slice(-count).reverse() : [];
  return { peak, lean, short, median, closedDays: closed.length };
}
