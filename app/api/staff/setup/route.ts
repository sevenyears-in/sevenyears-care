import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  createSessionValue,
  hashPassword,
  normaliseUserId,
  passwordProblem,
  SESSION_COOKIE,
  sessionCookieOptions,
  userIdProblem,
} from "@/lib/auth";

// First-time setup: creates the first administrator.
// Only works while there are NO staff users at all.

async function staffCount() {
  const { count, error } = await supabaseAdmin
    .from("staff_users")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function GET() {
  try {
    return NextResponse.json({ setupAvailable: (await staffCount()) === 0 });
  } catch (error) {
    console.error("Setup check error:", error);
    return NextResponse.json(
      { error: "Database not ready. Did you run supabase/setup.sql?" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    if ((await staffCount()) > 0) {
      return NextResponse.json(
        { error: "Setup is already complete. Please log in." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const fullName = String(body.fullName ?? "").trim();
    const userId = normaliseUserId(body.userId);
    const password = String(body.password ?? "");
    const storeName = String(body.storeName ?? "").trim();

    if (!fullName) {
      return NextResponse.json({ error: "Enter your name." }, { status: 400 });
    }
    const idProblem = userIdProblem(userId);
    if (idProblem) return NextResponse.json({ error: idProblem }, { status: 400 });
    const pwProblem = passwordProblem(password);
    if (pwProblem) return NextResponse.json({ error: pwProblem }, { status: 400 });

    const { data: admin, error } = await supabaseAdmin
      .from("staff_users")
      .insert({
        user_id: userId,
        full_name: fullName,
        password_hash: hashPassword(password),
        role: "admin",
        store_name: storeName || null,
      })
      .select("id, session_version")
      .single();

    if (error) throw error;

    const response = NextResponse.json({ success: true }, { status: 201 });
    response.cookies.set(
      SESSION_COOKIE,
      createSessionValue(admin.id, admin.session_version),
      sessionCookieOptions
    );
    return response;
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { error: "Unable to complete setup. Check the server log." },
      { status: 500 }
    );
  }
}
