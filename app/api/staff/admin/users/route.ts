import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  hashPassword,
  normaliseUserId,
  passwordProblem,
  requireStaff,
  userIdProblem,
} from "@/lib/auth";
import { cleanMobile, isValidMobile } from "@/lib/helpers";
import { isRole, type Role } from "@/lib/roles";

// Staff management (Super Admin and Admin).
// GET    → list staff + known store names
// POST   → create staff   { fullName, userId, password, role, storeName, email, whatsappNumber }
// PATCH  → update staff   { id, fullName?, role?, storeName?, email?, whatsappNumber?,
//                           notifyEmail?, notifyWhatsapp?, isActive?, newPassword? }
//
// Only the Super Admin can create or change Super Admin / Admin accounts.

const PROTECTED_ROLES: Role[] = ["super_admin", "admin"];

function emailProblem(email: string) {
  return email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "E-mail address is not valid." : null;
}

function whatsappValue(value: unknown): { value: string | null; error?: string } {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: null };
  const mobile = cleanMobile(raw);
  if (!isValidMobile(mobile)) return { value: null, error: "WhatsApp number must be a valid 10-digit mobile number." };
  return { value: mobile };
}

export async function GET() {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;

  const [{ data, error }, stores] = await Promise.all([
    supabaseAdmin
      .from("staff_users")
      .select(
        "id, user_id, full_name, role, store_name, email, whatsapp_number, notify_email, notify_whatsapp, is_active, last_login_at, created_at"
      )
      .order("created_at", { ascending: true }),
    supabaseAdmin.from("stores").select("store_name").order("store_name"),
  ]);

  if (error) {
    console.error("List staff error:", error);
    return NextResponse.json({ error: "Unable to load staff. Did you run supabase/workflow-upgrade.sql?" }, { status: 500 });
  }

  const storeNames = new Set<string>();
  for (const s of stores.data ?? []) if (s.store_name) storeNames.add(String(s.store_name));
  for (const u of data ?? []) if (u.store_name) storeNames.add(String(u.store_name));

  return NextResponse.json({
    users: data ?? [],
    currentUserId: auth.staff.id,
    currentRole: auth.staff.role,
    storeNames: [...storeNames].sort(),
  });
}

export async function POST(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const fullName = String(body.fullName ?? "").trim();
    const userId = normaliseUserId(body.userId);
    const password = String(body.password ?? "");
    const role: Role = isRole(body.role) ? body.role : "staff";
    const storeName = String(body.storeName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const whatsapp = whatsappValue(body.whatsappNumber);

    if (!fullName) return NextResponse.json({ error: "Enter the staff name." }, { status: 400 });
    const idProblem = userIdProblem(userId);
    if (idProblem) return NextResponse.json({ error: idProblem }, { status: 400 });
    const pwProblem = passwordProblem(password);
    if (pwProblem) return NextResponse.json({ error: pwProblem }, { status: 400 });
    const mailProblem = emailProblem(email);
    if (mailProblem) return NextResponse.json({ error: mailProblem }, { status: 400 });
    if (whatsapp.error) return NextResponse.json({ error: whatsapp.error }, { status: 400 });

    if (PROTECTED_ROLES.includes(role) && auth.staff.role !== "super_admin") {
      return NextResponse.json({ error: "Only the Super Admin can create admin accounts." }, { status: 403 });
    }
    if ((role === "store_manager" || role === "technician") && !storeName) {
      return NextResponse.json({ error: "Store Managers and Technicians need a store." }, { status: 400 });
    }

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
      email: email || null,
      whatsapp_number: whatsapp.value,
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
      .select("id, role, session_version")
      .eq("id", id)
      .maybeSingle();

    if (!target) return NextResponse.json({ error: "Staff user not found." }, { status: 404 });

    const isSelf = id === auth.staff.id;
    const actorIsSuper = auth.staff.role === "super_admin";

    // Admins can't edit Super Admin / Admin accounts (other than themselves).
    if (!actorIsSuper && !isSelf && PROTECTED_ROLES.includes(target.role as Role)) {
      return NextResponse.json({ error: "Only the Super Admin can change admin accounts." }, { status: 403 });
    }

    const update: Record<string, unknown> = {};

    if (typeof body.fullName === "string" && body.fullName.trim()) {
      update.full_name = body.fullName.trim();
    }

    if (typeof body.storeName === "string") {
      update.store_name = body.storeName.trim() || null;
    }

    if (typeof body.email === "string") {
      const email = body.email.trim().toLowerCase();
      const problem = emailProblem(email);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      update.email = email || null;
    }

    if (typeof body.whatsappNumber === "string") {
      const whatsapp = whatsappValue(body.whatsappNumber);
      if (whatsapp.error) return NextResponse.json({ error: whatsapp.error }, { status: 400 });
      update.whatsapp_number = whatsapp.value;
    }

    if (typeof body.notifyEmail === "boolean") update.notify_email = body.notifyEmail;
    if (typeof body.notifyWhatsapp === "boolean") update.notify_whatsapp = body.notifyWhatsapp;

    if (isRole(body.role) && body.role !== target.role) {
      if (isSelf) {
        return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
      }
      if (PROTECTED_ROLES.includes(body.role) && !actorIsSuper) {
        return NextResponse.json({ error: "Only the Super Admin can give admin access." }, { status: 403 });
      }
      update.role = body.role;
      update.session_version = target.session_version + 1; // new permissions on next login
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
