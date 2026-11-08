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

async function accessToken(sa: ServiceAccount, fresh = false) {
  if (!fresh && cached && cached.until > Date.now()) return cached.token;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
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
  if (!fresh) cached = { token: data.access_token, until: Date.now() + ((data.expires_in ?? 3600) - 300) * 1000 };
  return data.access_token;
}

export type PushMessage = { title: string; body: string; url?: string };

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
        data: { url: msg.url ?? "" },
        android: { priority: "high", notification: { channel_id: "offers" } },
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

/** Everyone who has the app (they all follow the "offers" topic). */
export async function pushToAll(msg: PushMessage) {
  await send({ topic: OFFERS_TOPIC }, msg);
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
