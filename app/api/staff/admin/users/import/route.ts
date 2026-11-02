import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { hashPassword, normaliseUserId, requireStaff, userIdProblem } from "@/lib/auth";
import { cleanMobile, isValidMobile } from "@/lib/helpers";
import { isRole } from "@/lib/roles";
import { CORPORATE_OFFICE, getStores, matchStore } from "@/lib/stores";

// POST /api/staff/admin/users/import — Super Admin: add many staff at once (e.g. from the employee list).
// Body: { users: [{ fullName, userId, password, role, store?, stores?, email?, whatsapp? }] }
// Temporary passwords may be short (e.g. the User ID); everyone must choose their own at first login.
// Existing User IDs are skipped.
export async function POST(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { users?: Record<string, unknown>[] };
  const users = Array.isArray(body.users) ? body.users.slice(0, 500) : [];
  if (users.length === 0) return NextResponse.json({ error: "No staff in the list." }, { status: 400 });

  const storeList = (await getStores()).stores;
  const findStore = (value: unknown) => {
    const v = String(value ?? "").trim();
    if (!v) return null;
    if (v.toLowerCase() === CORPORATE_OFFICE.toLowerCase()) return CORPORATE_OFFICE;
    return matchStore(storeList, v)?.name ?? null;
  };

  const { data: existing } = await supabaseAdmin.from("staff_users").select("user_id");
  const taken = new Set((existing ?? []).map((u) => String(u.user_id)));

  const results: { userId: string; status: "created" | "skipped" | "error"; message?: string }[] = [];
  for (const u of users) {
    const userId = normaliseUserId(u.userId);
    const fullName = String(u.fullName ?? "").replace(/\s+/g, " ").trim();
    const password = String(u.password ?? "").trim();
    const role = String(u.role ?? "").trim().toLowerCase();
    const idProblem = userIdProblem(userId);

    if (idProblem || !fullName || password.length < 4 || !isRole(role) || role === "staff" || role === "super_admin") {
      results.push({ userId, status: "error", message: idProblem ?? "Name, password (4+ characters) and a valid role are needed." });
      continue;
    }
    if (taken.has(userId)) {
      results.push({ userId, status: "skipped", message: "User ID already exists." });
      continue;
    }

    const stores = Array.isArray(u.stores) ? u.stores.map(findStore).filter((s): s is string => Boolean(s)) : [];
    const store = findStore(u.store) ?? stores[0] ?? null;
    if (u.store && !store) {
      results.push({ userId, status: "error", message: `Store "${String(u.store)}" is not in the store list.` });
      continue;
    }
    const whatsapp = cleanMobile(u.whatsapp);
    const email = String(u.email ?? "").trim().toLowerCase();

    const { error } = await supabaseAdmin.from("staff_users").insert({
      user_id: userId,
      full_name: fullName,
      password_hash: hashPassword(password),
      role,
      store_name: store,
      director_stores: role === "director" ? (stores.length ? stores : store ? [store] : []) : [],
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      whatsapp_number: isValidMobile(whatsapp) ? whatsapp : null,
      must_change_password: true,
    });
    if (error) {
      results.push({ userId, status: "error", message: error.message });
    } else {
      taken.add(userId);
      results.push({ userId, status: "created" });
    }
  }

  return NextResponse.json({
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error"),
    results,
  });
}
