// Alert settings (e-mail, WhatsApp, automatic escalation) — server only.
// Entered by the Super Admin on Staff → Alerts Setup and kept in Supabase
// (app_settings "notifications"). Environment variables still work as a
// fallback for anything left blank on that page.

import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";

const KEY = "notifications";

export type AlertSettings = {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  mailFrom: string;
  waToken: string;
  waPhoneNumberId: string;
  waStaffTemplate: string;
  waCustomerTemplate: string;
  waLanguage: string;
  cronSecret: string;
};

/** Fields that are never sent back to the browser. */
export const SECRET_FIELDS = ["smtpPass", "waToken"] as const;

type Saved = Partial<AlertSettings>;

let cache: { value: Saved; at: number } | null = null;

export async function loadSavedAlertSettings(fresh = false): Promise<Saved> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.value;
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    const value = (data?.value as Saved) ?? {};
    cache = { value, at: Date.now() };
    return value;
  } catch {
    return cache?.value ?? {};
  }
}

export async function saveAlertSettings(value: Saved) {
  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ key: KEY, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  cache = { value, at: Date.now() };
}

const pick = (saved: unknown, env: string | undefined, fallback = "") => {
  const s = typeof saved === "string" ? saved.trim() : saved == null ? "" : String(saved).trim();
  return s || env?.trim() || fallback;
};

/** Settings in use: saved on the Alerts Setup page, else environment variables, else defaults. */
export async function alertSettings(): Promise<AlertSettings> {
  const s = await loadSavedAlertSettings();
  const env = process.env;
  const smtpUser = pick(s.smtpUser, env.SMTP_USER);
  return {
    smtpHost: pick(s.smtpHost, env.SMTP_HOST),
    smtpPort: Number(pick(s.smtpPort, env.SMTP_PORT, "465")) || 465,
    smtpUser,
    smtpPass: typeof s.smtpPass === "string" && s.smtpPass ? s.smtpPass : env.SMTP_PASS ?? "",
    mailFrom: pick(s.mailFrom, env.MAIL_FROM, smtpUser),
    waToken: pick(s.waToken, env.WHATSAPP_TOKEN),
    waPhoneNumberId: pick(s.waPhoneNumberId, env.WHATSAPP_PHONE_NUMBER_ID),
    waStaffTemplate: pick(s.waStaffTemplate, env.WHATSAPP_STAFF_TEMPLATE, "staff_ticket_alert"),
    waCustomerTemplate: pick(s.waCustomerTemplate, env.WHATSAPP_CUSTOMER_TEMPLATE, "customer_ticket_update"),
    waLanguage: pick(s.waLanguage, env.WHATSAPP_TEMPLATE_LANGUAGE, "en"),
    cronSecret: pick(s.cronSecret, env.CRON_SECRET),
  };
}

export function newCronSecret() {
  return randomBytes(24).toString("base64url");
}
