// Log of Zoho POS sales copies (server only): when, how, what was read and saved, errors.
// Kept in app_settings "sales_sync_log" (the last 80 runs).

import { supabaseAdmin } from "@/lib/supabase/server";

export type SyncLogEntry = {
  at: string;
  kind: "scheduled" | "manual" | "night" | "check";
  status: "ok" | "partial" | "failed";
  ms: number;
  days: { date: string; bills: number; billsSaved: number; returns: number; returnsSaved: number; pending: number }[];
  error: string | null;
  retried: boolean;
  by?: string | null;
};

const KEY = "sales_sync_log";

export async function loadSyncLog(): Promise<SyncLogEntry[]> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  const list = (data?.value as { runs?: SyncLogEntry[] } | null)?.runs;
  return Array.isArray(list) ? list : [];
}

export async function appendSyncLog(entry: SyncLogEntry) {
  try {
    const runs = [entry, ...(await loadSyncLog())].slice(0, 80);
    await supabaseAdmin.from("app_settings").upsert({ key: KEY, value: { runs }, updated_at: new Date().toISOString() });
  } catch (error) {
    console.error("Sync log failed:", error);
  }
}

/** Last successful (or partly successful) scheduled/manual copy. */
export function lastGoodSync(runs: SyncLogEntry[]) {
  return runs.find((r) => r.status !== "failed" && r.kind !== "check") ?? null;
}

/** Errors worth one more try (network, Zoho busy, rate limit). */
export const isTransient = (message: string) => /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|timeout|\b5\d\d\b|429|too many|rate limit|temporar/i.test(message);
