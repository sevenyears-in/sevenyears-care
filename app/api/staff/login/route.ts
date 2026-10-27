import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  createSessionValue,
  normaliseUserId,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";

// Simple protection against password guessing: 5 wrong attempts for a
// User ID locks it for 15 minutes (per server instance).
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userId = normaliseUserId(body.userId);
    const password = String(body.password ?? "");

    if (!userId || !password) {
      return NextResponse.json(
        { error: "Enter your User ID and password." },
        { status: 400 }
      );
    }

    const record = failures.get(userId);
    if (record && record.until > Date.now()) {
      return NextResponse.json(
        { error: "Too many wrong attempts. Please try again in 15 minutes." },
        { status: 429 }
      );
    }

    const { data: staff, error } = await supabaseAdmin
      .from("staff_users")
      .select("id, password_hash, is_active, session_version")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;

    const ok = !!staff && staff.is_active && verifyPassword(password, staff.password_hash);

    if (!ok || !staff) {
      const count = (record && record.until <= Date.now() ? 0 : record?.count ?? 0) + 1;
      failures.set(userId, {
        count,
        until: count >= MAX_FAILURES ? Date.now() + LOCK_MS : 0,
      });

      return NextResponse.json(
        {
          error:
            staff && !staff.is_active
              ? "This account is disabled. Please contact your administrator."
              : "Incorrect User ID or password.",
        },
        { status: 401 }
      );
    }

    failures.delete(userId);

    await supabaseAdmin
      .from("staff_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", staff.id);

    const response = NextResponse.json({ success: true });
    response.cookies.set(
      SESSION_COOKIE,
      createSessionValue(staff.id, staff.session_version),
      sessionCookieOptions
    );
    return response;
  } catch (error) {
    console.error("Staff login error:", error);
    return NextResponse.json(
      { error: "Unable to log in right now. Please try again." },
      { status: 500 }
    );
  }
}
