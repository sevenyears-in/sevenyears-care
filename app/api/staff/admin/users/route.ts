import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  hashPassword,
  normaliseUserId,
  passwordProblem,
  requireStaff,
  userIdProblem,
} from "@/lib/auth";

// Admin-only staff management.
// GET    → list staff
// POST   → create staff   { fullName, userId, password, role, storeName }
// PATCH  → update staff   { id, fullName?, role?, storeName?, isActive?, newPassword? }

export async function GET() {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("staff_users")
    .select("id, user_id, full_name, role, store_name, is_active, last_login_at, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("List staff error:", error);
    return NextResponse.json({ error: "Unable to load staff." }, { status: 500 });
  }

  return NextResponse.json({ users: data ?? [], currentUserId: auth.staff.id });
}

export async function POST(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const fullName = String(body.fullName ?? "").trim();
    const userId = normaliseUserId(body.userId);
    const password = String(body.password ?? "");
    const role = body.role === "admin" ? "admin" : "staff";
    const storeName = String(body.storeName ?? "").trim();

    if (!fullName) return NextResponse.json({ error: "Enter the staff name." }, { status: 400 });
    const idProblem = userIdProblem(userId);
    if (idProblem) return NextResponse.json({ error: idProblem }, { status: 400 });
    const pwProblem = passwordProblem(password);
    if (pwProblem) return NextResponse.json({ error: pwProblem }, { status: 400 });

    const { data: existing } = await supabaseAdmin
      .from("staff_users")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "This User ID is already taken." }, { status: 409 });
    }

    const { error } = await supabaseAdmin.from("staff_users").insert({
      user_id: userId,
      full_name: fullName,
      password_hash: hashPassword(password),
      role,
      store_name: storeName || null,
    });

    if (error) throw error;
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Create staff error:", error);
    return NextResponse.json({ error: "Unable to create the staff user." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "Missing staff id." }, { status: 400 });

    const { data: target } = await supabaseAdmin
      .from("staff_users")
      .select("id, session_version")
      .eq("id", id)
      .maybeSingle();

    if (!target) return NextResponse.json({ error: "Staff user not found." }, { status: 404 });

    const isSelf = id === auth.staff.id;
    const update: Record<string, unknown> = {};

    if (typeof body.fullName === "string" && body.fullName.trim()) {
      update.full_name = body.fullName.trim();
    }

    if (typeof body.storeName === "string") {
      update.store_name = body.storeName.trim() || null;
    }

    if (body.role === "admin" || body.role === "staff") {
      if (isSelf && body.role !== "admin") {
        return NextResponse.json(
          { error: "You can't remove your own admin access." },
          { status: 400 }
        );
      }
      update.role = body.role;
    }

    if (typeof body.isActive === "boolean") {
      if (isSelf && !body.isActive) {
        return NextResponse.json(
          { error: "You can't disable your own account." },
          { status: 400 }
        );
      }
      update.is_active = body.isActive;
      if (!body.isActive) update.session_version = target.session_version + 1;
    }

    if (typeof body.newPassword === "string" && body.newPassword) {
      const pwProblem = passwordProblem(body.newPassword);
      if (pwProblem) return NextResponse.json({ error: pwProblem }, { status: 400 });
      update.password_hash = hashPassword(body.newPassword);
      // log the user out of every device (except when admins change their own)
      if (!isSelf) update.session_version = target.session_version + 1;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("staff_users").update(update).eq("id", id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update staff error:", error);
    return NextResponse.json({ error: "Unable to update the staff user." }, { status: 500 });
  }
}
