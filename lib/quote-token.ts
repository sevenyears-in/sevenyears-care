// Signed link for a paid-service repair quote: /service-quote/<token> (server only).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { siteUrl } from "@/lib/notify";

function key() {
  const base = process.env.CUSTOMER_SESSION_SECRET || process.env.STAFF_SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || "";
  return createHash("sha256").update(`sy-quote:${base}`).digest();
}

export function quoteToken(requestId: string) {
  const payload = Buffer.from(`quote:${requestId}`).toString("base64url");
  const sig = createHmac("sha256", key()).update(payload).digest("base64url").slice(0, 22);
  return `${payload}.${sig}`;
}

export function readQuoteToken(token: string): string | null {
  const [payload, sig] = String(token ?? "").split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", key()).update(payload).digest("base64url").slice(0, 22);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [kind, id] = Buffer.from(payload, "base64url").toString("utf8").split(":");
  return kind === "quote" && /^[0-9a-f-]{36}$/i.test(id ?? "") ? id : null;
}

export const quoteLink = (requestId: string) => `${siteUrl()}/service-quote/${quoteToken(requestId)}`;
