import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  createSessionValue,
  hashPassword,
  passwordProblem,
  requireStaff,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";

// POST /api/staff/password { currentPassword, newPassword } — staff change their own password.
export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { currentPassword?: string; newPassword?: string };
  const current = String(body.currentPassword ?? "");
  const next = String(body.newPassword ?? "");

  const problem = passwordProblem(next);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (next === current) return NextResponse.json({ error: "Choose a new password, different from the current one." }, { status: 400 });

  const { data: row } = await supabaseAdmin
    .from("staff_users")
    .select("password_hash, session_version")
    .eq("id", auth.staff.id)
    .maybeSingle();
  if (!row || !verifyPassword(current, row.password_hash)) {
    return NextResponse.json({ error: "Your current password is not correct." }, { status: 400 });
  }

  const sessionVersion = (row.session_version ?? 1) + 1;
  const { error } = await supabaseAdmin
    .from("staff_users")
    .update({ password_hash: hashPassword(next), must_change_password: false, session_version: sessionVersion })
    .eq("id", auth.staff.id);
  if (error) {
    console.error("Staff password change error:", error);
    return NextResponse.json({ error: "Unable to change the password. Please try again." }, { status: 500 });
  }

  // Logged out everywhere else; stay logged in here.
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, createSessionValue(auth.staff.id, sessionVersion), sessionCookieOptions);
  return response;
}
