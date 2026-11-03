// Complaint channels: WhatsApp and the Seven Years chatbot "Sevi" (formerly "Aira"; settings keep the old key names) (server only).
// Set by the Super Admin on Staff → Complaint Channels; kept in Supabase
// (app_settings "channels"). WhatsApp uses the token and phone number ID
// from Alerts Setup to send its replies.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";

const KEY = "channels";

export type ChannelSettings = {
  waEnabled: boolean;
  /** Text Meta sends back when the webhook is first connected. */
  waVerifyToken: string;
  /** Meta app secret — used to check that messages really come from Meta. */
  waAppSecret: string;
  airaEnabled: boolean;
  airaApiKey: string;
};

let cache: { value: ChannelSettings; at: number } | null = null;

export function randomKey(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

export async function channelSettings(fresh = false): Promise<ChannelSettings> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.value;
  let saved: Partial<ChannelSettings> = {};
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    saved = (data?.value as Partial<ChannelSettings>) ?? {};
  } catch {
    saved = cache?.value ?? {};
  }
  const value: ChannelSettings = {
    waEnabled: Boolean(saved.waEnabled),
    waVerifyToken: String(saved.waVerifyToken ?? ""),
    waAppSecret: String(saved.waAppSecret ?? ""),
    airaEnabled: Boolean(saved.airaEnabled),
    airaApiKey: String(saved.airaApiKey ?? ""),
  };
  cache = { value, at: Date.now() };
  return value;
}

export async function saveChannelSettings(value: ChannelSettings) {
  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ key: KEY, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  cache = { value, at: Date.now() };
}

export function sameSecret(given: string, expected: string) {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
