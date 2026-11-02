// Customer accounts (server only).
// User ID = the customer's 10-digit mobile number.
// First password = the last 4 digits of the bill number on which their
// warranty was registered (e.g. bill VDK26-SI1-8504 → 8504). They can change it.
// Session: HttpOnly cookie signed with HMAC (separate from the staff cookie).

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { isValidMobile } from "@/lib/helpers";

export const CUSTOMER_COOKIE = "sy_customer_session";
const SESSION_DAYS = 30;

export type Customer = { mobile: string; name: string | null; email: string | null };

/** Last 4 digits of a bill number (padded with 0 if it has fewer). */
export function billPassword(billNumber: string) {
  const digits = String(billNumber ?? "").replace(/\D/g, "");
  return digits.slice(-4).padStart(4, "0");
}

export function customerPasswordProblem(password: string) {
  if (password.length < 6) return "Use at least 6 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use letters and numbers.";
  return null;
}

/**
 * Called when a customer raises a service request or complaint on the website
 * and has no login yet: User ID = mobile, password = last 4 digits of the mobile.
 */
export async function ensureCustomerAccountFromRequest(mobile: string, name: string, email?: string | null) {
  if (!isValidMobile(mobile)) return { created: false };
  const { data: existing } = await supabaseAdmin
    .from("customer_accounts")
    .select("mobile")
    .eq("mobile", mobile)
    .maybeSingle();
  if (existing) return { created: false };
  const { error } = await supabaseAdmin.from("customer_accounts").insert({
    mobile,
    full_name: name || null,
    email: email || null,
    password_hash: hashPassword(mobile.slice(-4)),
  });
  if (error) {
    if ((error as { code?: string }).code !== "23505") console.error("Create customer account (request) error:", error);
    return { created: false };
  }
  return { created: true };
}

/**
 * Called when staff register a warranty: creates the customer's login if they
 * don't have one yet. An existing login (and any password they chose) is kept.
 */
export async function ensureCustomerAccount(mobile: string, name: string, billNumber: string) {
  if (!isValidMobile(mobile)) return { created: false };
  const { data: existing } = await supabaseAdmin
    .from("customer_accounts")
    .select("mobile")
    .eq("mobile", mobile)
    .maybeSingle();
  if (existing) return { created: false };

  const { error } = await supabaseAdmin.from("customer_accounts").insert({
    mobile,
    full_name: name || null,
    password_hash: hashPassword(billPassword(billNumber)),
  });
  if (error) {
    // 23505 = someone else created it at the same moment
    if ((error as { code?: string }).code !== "23505") console.error("Create customer account error:", error);
    return { created: false };
  }
  return { created: true };
}

// ------------------------------------------------------------------
// Login
// ------------------------------------------------------------------

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const memoryFailures = new Map<string, { count: number; until: number }>();

export type LoginResult =
  | { ok: true; mobile: string; sessionVersion: number }
  | { ok: false; error: string; status: number };

export async function customerLogin(mobile: string, password: string): Promise<LoginResult> {
  if (!isValidMobile(mobile) || !password) {
    return { ok: false, error: "Enter your 10-digit mobile number and password.", status: 400 };
  }

  const mem = memoryFailures.get(mobile);
  if (mem && mem.until > Date.now()) {
    return { ok: false, error: `Too many wrong attempts. Try again in ${LOCK_MINUTES} minutes.`, status: 429 };
  }

  const { data: account } = await supabaseAdmin
    .from("customer_accounts")
    .select("mobile, password_hash, session_version, failed_attempts, locked_until")
    .eq("mobile", mobile)
    .maybeSingle();

  if (account?.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
    return { ok: false, error: `Too many wrong attempts. Try again in ${LOCK_MINUTES} minutes.`, status: 429 };
  }

  let ok = false;
  let sessionVersion = 1;

  if (account) {
    ok = verifyPassword(password, account.password_hash);
    sessionVersion = account.session_version ?? 1;
  } else if (/^\d{4}$/.test(password)) {
    // Warranties registered before customer logins existed: accept the last
    // 4 digits of any of their bills and create the login now.
    const { data: warranties } = await supabaseAdmin
      .from("warranties")
      .select("bill_number, customer_name")
      .eq("customer_mobile", mobile)
      .limit(50);
    const match = (warranties ?? []).find((w) => billPassword(String(w.bill_number)) === password);
    if (match) {
      await ensureCustomerAccount(mobile, String(match.customer_name ?? ""), String(match.bill_number));
      ok = true;
    }
  }

  if (!ok) {
    const count = (mem && mem.until <= Date.now() ? 0 : mem?.count ?? 0) + 1;
    memoryFailures.set(mobile, { count, until: count >= MAX_FAILURES ? Date.now() + LOCK_MINUTES * 60_000 : 0 });
    if (account) {
      const failed = (account.failed_attempts ?? 0) + 1;
      await supabaseAdmin
        .from("customer_accounts")
        .update({
          failed_attempts: failed >= MAX_FAILURES ? 0 : failed,
          locked_until: failed >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
        })
        .eq("mobile", mobile);
    }
    return {
      ok: false,
      error:
        "Mobile number or password is not correct. Your first password is the last 4 digits of your bill number (or of your mobile number if your login was made when you raised a request).",
      status: 401,
    };
  }

  memoryFailures.delete(mobile);
  await supabaseAdmin
    .from("customer_accounts")
    .update({ failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() })
    .eq("mobile", mobile);

  return { ok: true, mobile, sessionVersion };
}

export async function changeCustomerPassword(mobile: string, current: string, next: string) {
  const problem = customerPasswordProblem(next);
  if (problem) return { ok: false as const, error: problem };

  const { data: account } = await supabaseAdmin
    .from("customer_accounts")
    .select("password_hash, session_version")
    .eq("mobile", mobile)
    .maybeSingle();
  if (!account || !verifyPassword(current, account.password_hash)) {
    return { ok: false as const, error: "Your current password is not correct." };
  }

  const sessionVersion = (account.session_version ?? 1) + 1;
  const { error } = await supabaseAdmin
    .from("customer_accounts")
    .update({ password_hash: hashPassword(next), password_changed_at: new Date().toISOString(), session_version: sessionVersion })
    .eq("mobile", mobile);
  if (error) {
    console.error("Change customer password error:", error);
    return { ok: false as const, error: "Unable to change the password. Please try again." };
  }
  return { ok: true as const, sessionVersion };
}

// ------------------------------------------------------------------
// Session cookie
// ------------------------------------------------------------------

function secret() {
  const own = process.env.CUSTOMER_SESSION_SECRET || process.env.STAFF_SESSION_SECRET;
  const base = own && own.length >= 32 ? own : process.env.SUPABASE_SECRET_KEY ?? "";
  if (!base) throw new Error("SUPABASE_SECRET_KEY is missing.");
  return createHash("sha256").update(`sy-customer-session:${base}`).digest("hex");
}

const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

export function customerSessionValue(mobile: string, sessionVersion: number) {
  const payload = Buffer.from(
    JSON.stringify({ m: mobile, v: sessionVersion, exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export const customerCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60,
};

function readSession(value: string | undefined) {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { m: string; v: number; exp: number };
    if (!data.m || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

/** The logged-in customer, or null. Cached for the length of one request. */
export const getCurrentCustomer = cache(async (): Promise<Customer | null> => {
  const cookieStore = await cookies();
  const session = readSession(cookieStore.get(CUSTOMER_COOKIE)?.value);
  if (!session) return null;

  const { data } = await supabaseAdmin
    .from("customer_accounts")
    .select("mobile, full_name, email, session_version")
    .eq("mobile", session.m)
    .maybeSingle();
  if (!data || (data.session_version ?? 1) !== session.v) return null;
  return {
    mobile: String(data.mobile),
    name: data.full_name ? String(data.full_name) : null,
    email: data.email ? String(data.email) : null,
  };
});
