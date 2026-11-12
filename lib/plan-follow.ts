// Follow-up status of action plan points (server only).

import { supabaseAdmin } from "@/lib/supabase/server";

export type FollowStatus = "open" | "in_progress" | "done" | "not_relevant";
export type Follow = { key: string; role: string; month: string; status: FollowStatus; note: string | null; updated_by: string | null; updated_at: string };

/** This month's and last month's follow-ups for a store, by key. */
export async function loadFollow(store: string, month: string, prevMonth: string) {
  const { data } = await supabaseAdmin.from("action_plan_follow").select("key, role, month, status, note, updated_by, updated_at").eq("store", store).in("month", [month, prevMonth]);
  const now = new Map<string, Follow>();
  const before = new Map<string, Follow>();
  for (const r of (data ?? []) as Follow[]) (r.month === month ? now : before).set(r.key, r);
  return { now, before };
}
