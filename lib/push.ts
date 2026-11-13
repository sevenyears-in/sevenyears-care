// Phone notifications through Firebase Cloud Messaging (server only).
// The Firebase service-account key is pasted once by the Super Admin (Offers page) and kept in
// app_settings — it is never sent back to the browser.

import { createSign } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";

const KEY = "push_service_account";
export const OFFERS_TOPIC = "offers";

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

export async function loadServiceAccount(): Promise<ServiceAccount | null> {
  const env = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (env) {
    try {
      return JSON.parse(env) as ServiceAccount;
    } catch {
      /* fall through */
    }
  }
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  const v = data?.value as ServiceAccount | undefined;
  return v?.private_key && v.client_email && v.project_id ? v : null;
}

/** Checks the pasted key file and saves it. Returns the service account e-mail. */
export async function saveServiceAccount(raw: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  let json: Partial<ServiceAccount> & { type?: string };
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That is not the key file. Paste the whole contents of the downloaded .json file." };
  }
  if (json.type !== "service_account" || !json.private_key || !json.client_email || !json.project_id) {
    return { ok: false, error: "That file is not a Firebase service-account key." };
  }
  const value = { project_id: json.project_id, client_email: json.client_email, private_key: json.private_key };
  try {
    await accessToken(value, true);
  } catch (error) {
    return { ok: false, error: `Google did not accept this key (${error instanceof Error ? error.message : "error"}).` };
  }
  const { error } = await supabaseAdmin.from("app_settings").upsert({ key: KEY, value, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "Could not save the key." };
  cached = null;
  return { ok: true, email: value.client_email };
}

let cached: { token: string; until: number } | null = null;

const MESSAGING_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const READ_SCOPE = "https://www.googleapis.com/auth/firebase.readonly";

async function accessToken(sa: ServiceAccount, fresh = false, scope = MESSAGING_SCOPE) {
  const useCache = scope === MESSAGING_SCOPE;
  if (useCache && !fresh && cached && cached.until > Date.now()) return cached.token;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  if (useCache && !fresh) cached = { token: data.access_token, until: Date.now() + ((data.expires_in ?? 3600) - 300) * 1000 };
  return data.access_token;
}

/** channel: the phone's notification channel — "staff_alerts" for staff (own sound, chosen on the phone), "offers" for customers. */
export type PushMessage = { title: string; body: string; url?: string; channel?: "offers" | "staff_alerts" };

async function send(target: { topic: string } | { token: string }, msg: PushMessage) {
  const sa = await loadServiceAccount();
  if (!sa) throw new Error("Phone notifications are not set up yet (Firebase key missing).");
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        ...target,
        notification: { title: msg.title.slice(0, 120), body: msg.body.slice(0, 500) },
        data: { url: msg.url ?? "", channel: msg.channel ?? "offers" },
        android: { priority: "high", notification: { channel_id: msg.channel ?? "offers" } },
        webpush: { notification: { icon: "/app-icon-192.png", badge: "/app-icon-192.png" }, fcm_options: msg.url ? { link: msg.url } : undefined },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
    const err = new Error(data.error?.message || `HTTP ${res.status}`) as Error & { status?: string };
    err.status = data.error?.status;
    throw err;
  }
}

/** Everyone: Android app users follow the "offers" topic; website/PWA users are sent one by one. */
export async function pushToAll(msg: PushMessage) {
  await send({ topic: OFFERS_TOPIC }, msg);
  const { data } = await supabaseAdmin.from("push_tokens").select("token").eq("platform", "web");
  await Promise.all(
    (data ?? []).map((t) =>
      send({ token: t.token }, msg).catch(async (error) => {
        const status = (error as { status?: string }).status;
        if (status === "NOT_FOUND" || status === "UNREGISTERED" || status === "INVALID_ARGUMENT")
          await supabaseAdmin.from("push_tokens").delete().eq("token", t.token);
      })
    )
  );
}

let webConfigCache: { at: number; value: Record<string, string> } | null = null;

/**
 * Public Firebase settings for the website (the same values every Firebase web page carries),
 * read from Firebase with the server key so they never need to be copied by hand.
 */
export async function webPushConfig(): Promise<Record<string, string> | null> {
  if (webConfigCache && Date.now() - webConfigCache.at < 6 * 3600_000) return webConfigCache.value;
  const sa = await loadServiceAccount();
  if (!sa) return null;
  const token = await accessToken(sa, false, READ_SCOPE);
  const base = `https://firebase.googleapis.com/v1beta1/projects/${sa.project_id}`;
  const list = (await fetch(`${base}/webApps`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then((r) =>
    r.json()
  )) as { apps?: { appId: string; state?: string }[] };
  const app = (list.apps ?? []).find((a) => a.state !== "DELETED");
  if (!app) return null;
  const cfg = (await fetch(`${base}/webApps/${app.appId}/config`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(
    (r) => r.json()
  )) as Record<string, string>;
  if (!cfg.apiKey || !cfg.appId) return null;
  const value = { apiKey: cfg.apiKey, appId: cfg.appId, projectId: cfg.projectId, messagingSenderId: cfg.messagingSenderId };
  webConfigCache = { at: Date.now(), value };
  return value;
}

/** One customer's phones (e.g. "your service is complete"). Removes tokens Google says are dead. Returns phones reached. */
export async function pushToCustomer(mobile: string, msg: PushMessage) {
  const { data } = await supabaseAdmin.from("push_tokens").select("token").eq("customer_mobile", mobile);
  let delivered = 0;
  for (const t of data ?? []) {
    try {
      await send({ token: t.token }, msg);
      delivered++;
    } catch (error) {
      if ((error as { status?: string }).status === "NOT_FOUND" || (error as { status?: string }).status === "UNREGISTERED") {
        await supabaseAdmin.from("push_tokens").delete().eq("token", t.token);
      } else console.error("Push to customer failed:", error);
    }
  }
  return delivered;
}

/**
 * Staff phones / browsers (the app or a home-screen web app where they switched notifications on).
 * Returns how many devices were reached; dead tokens are removed. Throws when push is not set up.
 */
export async function pushToStaff(staffIds: string[], msg: PushMessage): Promise<{ devices: number; sent: number; failed: number }> {
  const ids = [...new Set(staffIds.filter(Boolean))];
  if (!ids.length) return { devices: 0, sent: 0, failed: 0 };
  if (!(await loadServiceAccount())) throw new Error("Phone notifications are not set up yet (Firebase key missing).");
  const { data } = await supabaseAdmin.from("push_tokens").select("token").in("staff_id", ids);
  let sent = 0;
  let failed = 0;
  for (const t of data ?? []) {
    try {
      await send({ token: t.token }, { ...msg, channel: "staff_alerts" });
      sent++;
    } catch (error) {
      failed++;
      const status = (error as { status?: string }).status;
      if (status === "NOT_FOUND" || status === "UNREGISTERED") await supabaseAdmin.from("push_tokens").delete().eq("token", t.token);
    }
  }
  return { devices: (data ?? []).length, sent, failed };
}
