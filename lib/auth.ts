// Staff authentication (server only).
// - Passwords: salted scrypt hashes (Node's built-in crypto, no extra packages).
// - Session: an HttpOnly cookie signed with HMAC-SHA256 using STAFF_SESSION_SECRET.
//   Each request re-checks the staff row, so disabling a user or resetting
//   their password logs them out immediately.

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { asRole, isAdmin, type Role } from "@/lib/roles";

export const SESSION_COOKIE = "sy_staff_session";
const SESSION_HOURS = 12;

export type StaffUser = {
  id: string;
  userId: string;
  fullName: string;
  role: Role;
  storeName: string | null;
  email: string | null;
  whatsappNumber: string | null;
};

// ------------------------------------------------------------------
// Passwords
// ------------------------------------------------------------------

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, n, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;

  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: 8,
    p: 1,
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordProblem(password: string) {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Password must contain letters and numbers.";
  }
  return null;
}

export function normaliseUserId(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function userIdProblem(userId: string) {
  if (!/^[a-z0-9._-]{3,30}$/.test(userId)) {
    return "User ID must be 3–30 characters: letters, numbers, dot, dash or underscore.";
  }
  return null;
}

// ------------------------------------------------------------------
// Session cookie
// ------------------------------------------------------------------

/**
 * Key used to sign staff session cookies.
 * Uses STAFF_SESSION_SECRET when set; otherwise derives a key from the
 * (already secret, server-only) SUPABASE_SECRET_KEY, so no extra setup is needed.
 */
function secret() {
  const own = process.env.STAFF_SESSION_SECRET;
  if (own && own.length >= 32) return own;

  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseSecret) {
    throw new Error("SUPABASE_SECRET_KEY is missing from .env.local.");
  }
  return createHash("sha256").update(`sy-staff-session:${supabaseSecret}`).digest("hex");
}

function sign(data: string) {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createSessionValue(staffId: string, sessionVersion: number) {
  const payload = Buffer.from(
    JSON.stringify({
      sid: staffId,
      v: sessionVersion,
      exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
    })
  ).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_HOURS * 60 * 60,
};

function readSessionValue(value: string | undefined) {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sid: string;
      v: number;
      exp: number;
    };
    if (!data.sid || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

/** The logged-in staff member, or null. Use in server components and route handlers. */
export async function getCurrentStaff(): Promise<StaffUser | null> {
  const cookieStore = await cookies();
  const session = readSessionValue(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) return null;

  const full = await supabaseAdmin
    .from("staff_users")
    .select("id, user_id, full_name, role, store_name, email, whatsapp_number, is_active, session_version")
    .eq("id", session.sid)
    .maybeSingle();

  // Database not upgraded yet (supabase/workflow-upgrade.sql not run): keep logins working.
  const result = full.error
    ? await supabaseAdmin
        .from("staff_users")
        .select("id, user_id, full_name, role, store_name, is_active, session_version")
        .eq("id", session.sid)
        .maybeSingle()
    : full;

  const staff = result.data as unknown as {
    id: string;
    user_id: string;
    full_name: string;
    role: string;
    store_name: string | null;
    email?: string | null;
    whatsapp_number?: string | null;
    is_active: boolean;
    session_version: number;
  } | null;

  if (!staff || !staff.is_active || staff.session_version !== session.v) return null;

  return {
    id: staff.id,
    userId: staff.user_id,
    fullName: staff.full_name,
    role: asRole(staff.role),
    storeName: staff.store_name ?? null,
    email: staff.email ?? null,
    whatsappNumber: staff.whatsapp_number ?? null,
  };
}

/**
 * For API routes. Returns { staff } when allowed, or { response } to return
 * straight away (401 not logged in / 403 not allowed).
 *   "staff"       → any logged-in staff member
 *   "admin"       → Super Admin or Admin
 *   "super_admin" → Super Admin only (e.g. Zoho POS connection)
 */
export async function requireStaff(
  role: "staff" | "admin" | "super_admin" = "staff"
): Promise<{ staff: StaffUser; response?: undefined } | { staff?: undefined; response: NextResponse }> {
  const staff = await getCurrentStaff();

  if (!staff) {
    return {
      response: NextResponse.json(
        { error: "Your session has ended. Please log in again." },
        { status: 401 }
      ),
    };
  }

  if (role === "admin" && !isAdmin(staff.role)) {
    return {
      response: NextResponse.json(
        { error: "Only an administrator can do this." },
        { status: 403 }
      ),
    };
  }

  if (role === "super_admin" && staff.role !== "super_admin") {
    return {
      response: NextResponse.json(
        { error: "Only the Super Admin can do this." },
        { status: 403 }
      ),
    };
  }

  return { staff };
}
