// Signed links for customer feedback / complaint confirmation (server only).
// /feedback/<token> — the token says what is being rated and can't be guessed or changed.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type FeedbackKind = "sales" | "service" | "complaint";

function key() {
  const base = process.env.CUSTOMER_SESSION_SECRET || process.env.STAFF_SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || "";
  return createHash("sha256").update(`sy-feedback:${base}`).digest();
}

/** kind + id of the warranty bill (sales), service request or complaint. */
export function feedbackToken(kind: FeedbackKind, id: string) {
  const payload = Buffer.from(`${kind}:${id}`).toString("base64url");
  const sig = createHmac("sha256", key()).update(payload).digest("base64url").slice(0, 22);
  return `${payload}.${sig}`;
}

export function readFeedbackToken(token: string): { kind: FeedbackKind; id: string } | null {
  const [payload, sig] = String(token ?? "").split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", key()).update(payload).digest("base64url").slice(0, 22);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [kind, id] = Buffer.from(payload, "base64url").toString("utf8").split(":");
  if (!["sales", "service", "complaint"].includes(kind) || !id) return null;
  return { kind: kind as FeedbackKind, id };
}

export function feedbackLink(kind: FeedbackKind, id: string) {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") || "https://care.sevenyears.in";
  return `${site}/feedback/${feedbackToken(kind, id)}`;
}
