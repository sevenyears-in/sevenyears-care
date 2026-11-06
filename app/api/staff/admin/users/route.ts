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
import { SECTION_KEYS } from "@/lib/access";
import { loadAccessConfig } from "@/lib/access-config";
import { CORPORATE_OFFICE, getStores, matchStore } from "@/lib/stores";

// Staff management (Super Admin and Admin).
// GET    → list staff + store list (Zoho POS stores + CORPORATE OFFICE)
// POST   → create staff   { fullName, userId, password, role, storeName, email, whatsappNumber }
// PATCH  → update staff   { id, fullName?, role?, storeName?, email?, whatsappNumber?,
//                           notifyEmail?, notifyWhatsapp?, isActive?, newPassword? }
//
// Only the Super Admin can create or change Super Admin / Admin accounts.

const PROTECTED_ROLES: Role[] = ["super_admin", "admin", "director"];

/** Store must be a Zoho POS store or CORPORATE OFFICE. Returns the exact name. */
async function storeValue(value: unknown): Promise<{ value: string | null; error?: string }> {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: null };
  if (raw.toLowerCase() === CORPORATE_OFFICE.toLowerCase()) return { value: CORPORATE_OFFICE };
  const list = await getStores();
  const match = matchStore(list.stores, raw);
  if (match) return { value: match.name };
  return {
    value: null,
    error:
      list.source === "zoho"
        ? `"${raw}" is not a store in Zoho POS. Choose a store from the list.`
        : `"${raw}" is not in the store list.`,
  };
}

/** Directors: one or more stores (all Zoho stores they look after). */
async function directorStoresValue(value: unknown): Promise<{ value: string[]; error?: string }> {
  if (!Array.isArray(value)) return { value: [] };
  const list = await getStores();
  const out: string[] = [];
  for (const raw of value) {
    const match = matchStore(list.stores, String(raw ?? ""));
    if (!match) return { value: [], error: `"${String(raw)}" is not in the store list.` };
    if (!out.includes(match.name)) out.push(match.name);
  }
  return { value: out };
}

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

  const COLS =
    "id, user_id, full_name, role, store_name, director_stores, email, whatsapp_number, notify_email, notify_whatsapp, is_active, last_login_at, created_at";
  const [withAccess, storeList, access] = await Promise.all([
    supabaseAdmin.from("staff_users").select(`${COLS}, custom_role_id, extra_sections`).order("created_at", { ascending: true }),
    getStores(),
    loadAccessConfig(),
  ]);
  const { data, error } = withAccess.error
    ? await supabaseAdmin.from("staff_users").select(COLS).order("created_at", { ascending: true })
    : withAccess;

  if (error) {
    console.error("List staff error:", error);
    return NextResponse.json({ error: "Unable to load staff. Did you run supabase/workflow-upgrade.sql?" }, { status: 500 });
  }

  return NextResponse.json({
    users: data ?? [],
    currentUserId: auth.staff.id,
    currentRole: auth.staff.role,
    customRoles: access.custom.map((c) => ({ id: c.id, name: c.name, baseRole: c.baseRole })),
    stores: [{ name: CORPORATE_OFFICE, code: null }, ...storeList.stores],
    storeSource: storeList.source,
    storeError: storeList.error,
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
    let role: Role = isRole(body.role) && body.role !== "staff" ? body.role : "csa";
    // Custom role (Roles & Access): works like its built-in role. Super Admin only.
    let customRoleId: string | null = null;
    if (typeof body.customRoleId === "string" && body.customRoleId) {
      if (auth.staff.role !== "super_admin") return NextResponse.json({ error: "Only the Super Admin can give custom roles." }, { status: 403 });
      const custom = (await loadAccessConfig()).custom.find((c) => c.id === body.customRoleId);
      if (!custom) return NextResponse.json({ error: "That role no longer exists." }, { status: 400 });
      role = custom.baseRole;
      customRoleId = custom.id;
    }
    const store = await storeValue(body.storeName);
    const storeName = store.value ?? "";
    const directorStores = await directorStoresValue(body.directorStores);
    if (directorStores.error) return NextResponse.json({ error: directorStores.error }, { status: 400 });
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
    if (store.error) return NextResponse.json({ error: store.error }, { status: 400 });

    if (PROTECTED_ROLES.includes(role) && auth.staff.role !== "super_admin") {
      return NextResponse.json({ error: "Only the Super Admin can create admin accounts." }, { status: 403 });
    }
    if ((role === "store_manager" || role === "technician" || role === "csa" || role === "floor_incharge") && !storeName) {
      return NextResponse.json({ error: "Store Managers, Technicians and CSAs need a store." }, { status: 400 });
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
      // Directors belong to the Corporate Office; the stores they look after are in director_stores.
      store_name: role === "director" ? CORPORATE_OFFICE : storeName || null,
      director_stores: role === "director" ? directorStores.value : [],
      must_change_password: true,
      email: email || null,
      whatsapp_number: whatsapp.value,
      ...(customRoleId ? { custom_role_id: customRoleId } : {}),
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
      const store = await storeValue(body.storeName);
      if (store.error) return NextResponse.json({ error: store.error }, { status: 400 });
      update.store_name = target.role === "director" ? CORPORATE_OFFICE : store.value;
    }

    if (Array.isArray(body.directorStores)) {
      const ds = await directorStoresValue(body.directorStores);
      if (ds.error) return NextResponse.json({ error: ds.error }, { status: 400 });
      update.director_stores = ds.value;
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

    if (body.role === "staff" && target.role !== "staff") {
      return NextResponse.json({ error: "“Store Staff” is no longer used. Choose CSA or CRE." }, { status: 400 });
    }

    // Roles & Access (Super Admin): custom role and extra sections for this person.
    if (typeof body.customRoleId === "string" || Array.isArray(body.extraSections)) {
      if (!actorIsSuper) return NextResponse.json({ error: "Only the Super Admin can change access." }, { status: 403 });
      if (isSelf) return NextResponse.json({ error: "You can't change your own access." }, { status: 400 });
    }
    if (typeof body.customRoleId === "string" && body.customRoleId) {
      const custom = (await loadAccessConfig()).custom.find((c) => c.id === body.customRoleId);
      if (!custom) return NextResponse.json({ error: "That role no longer exists." }, { status: 400 });
      update.custom_role_id = custom.id;
      update.role = custom.baseRole;
    }
    if (Array.isArray(body.extraSections)) {
      update.extra_sections = SECTION_KEYS.filter((k) => (body.extraSections as unknown[]).includes(k));
    }

    if (isRole(body.role) && (body.role !== target.role || body.clearCustom)) {
      update.custom_role_id = null; // a built-in role replaces any custom role
      if (isSelf) {
        return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
      }
      if (PROTECTED_ROLES.includes(body.role) && !actorIsSuper) {
        return NextResponse.json({ error: "Only the Super Admin can give admin access." }, { status: 403 });
      }
      update.role = body.role;
      update.session_version = target.session_version + 1; // new permissions on next login
      if (body.role === "director") update.store_name = CORPORATE_OFFICE;
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
      if (!isSelf) update.must_change_password = true;
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
