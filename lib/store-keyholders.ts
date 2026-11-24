// Extra people allowed to open / close a store (server only). By the SOP only the Store Manager
// or the ASM / Floor Manager opens and closes; the Super Admin can allow someone else for a
// store, ongoing (no dates) or for set dates (e.g. while the SM is on leave). Their openings /
// closings then follow the SOP. Kept in app_settings ("store_keyholders").

import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { attendanceCode } from "@/lib/attendance";

const KEY = "store_keyholders";

export type KeyHolder = {
  id: string;
  store: string;
  /** Employee code / User ID. */
  code: string;
  name: string;
  kinds: ("open" | "close")[];
  /** YYYY-MM-DD, inclusive; null = no limit. */
  from: string | null;
  to: string | null;
  note: string;
  by: string;
  at: string;
};

let cache: { at: number; list: KeyHolder[] } | null = null;

export async function loadKeyHolders(force = false): Promise<KeyHolder[]> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.list;
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  const list = Array.isArray((data?.value as { list?: unknown })?.list) ? ((data!.value as { list: KeyHolder[] }).list) : [];
  cache = { at: Date.now(), list };
  return list;
}

async function save(list: KeyHolder[]) {
  await supabaseAdmin.from("app_settings").upsert({ key: KEY, value: { list }, updated_at: new Date().toISOString() });
  cache = { at: Date.now(), list };
}

/** Is this person allowed to open (close) this store on this day? */
export function keyHolderFor(list: KeyHolder[], store: string, day: string, kind: "open" | "close", code: string): KeyHolder | null {
  const c = attendanceCode(code);
  return (
    list.find(
      (k) => k.store === store && attendanceCode(k.code) === c && k.kinds.includes(kind) && (!k.from || k.from <= day) && (!k.to || day <= k.to)
    ) ?? null
  );
}

export async function addKeyHolder(k: Omit<KeyHolder, "id" | "at">): Promise<KeyHolder> {
  const list = await loadKeyHolders(true);
  const item: KeyHolder = { ...k, id: randomBytes(4).toString("hex"), at: new Date().toISOString() };
  await save([...list, item]);
  await applyToPastDays(item);
  return item;
}

export async function removeKeyHolder(id: string) {
  const list = await loadKeyHolders(true);
  await save(list.filter((k) => k.id !== id));
}

/**
 * Days already recorded as an SOP violation by this person (in the permission's dates, at most
 * the last 60 days) follow the SOP now.
 */
async function applyToPastDays(k: KeyHolder) {
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const earliest = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const from = k.from && k.from > earliest ? k.from : earliest;
  const to = k.to && k.to < today ? k.to : today;
  if (from > to) return;
  const note = `Allowed by ${k.by}${k.note ? ` — ${k.note}` : ""}`;
  for (const kind of k.kinds) {
    const c = kind === "open" ? "open" : "close";
    const by = kind === "open" ? "opened_by" : "closed_by";
    await supabaseAdmin
      .from("store_open_close")
      .update({ [`${c}_sop`]: "ok", [`${c}_sop_note`]: note })
      .eq("store", k.store)
      .eq(by, attendanceCode(k.code))
      .eq(`${c}_sop`, "violation")
      .gte("day", from)
      .lte("day", to);
  }
}
