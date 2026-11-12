import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { merchStores } from "@/lib/merch-access";
import { logAudit } from "@/lib/audit";

// POST { store, month, role, key, title, status, note } — follow-up of an action plan point.
// Store Manager, ASM / Floor Manager of that store, and management.
const STATUSES = ["open", "in_progress", "done", "not_relevant"];

export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const store = String(b.store ?? "").toUpperCase().slice(0, 60);
  const month = String(b.month ?? "");
  const role = String(b.role ?? "").slice(0, 10);
  const key = String(b.key ?? "").slice(0, 120);
  const status = String(b.status ?? "");
  const note = String(b.note ?? "").trim().slice(0, 300) || null;
  if (!store || !/^\d{4}-\d{2}$/.test(month) || !role || !key || !STATUSES.includes(status)) return NextResponse.json({ error: "Missing details." }, { status: 400 });
  const allowed = await merchStores(auth.staff, [store]);
  if (!allowed.includes(store)) return NextResponse.json({ error: "You can update plans of your own store only." }, { status: 403 });
  const { data: before } = await supabaseAdmin.from("action_plan_follow").select("status, note").eq("store", store).eq("month", month).eq("role", role).eq("key", key).maybeSingle();
  const row = { store, month, role, key, title: String(b.title ?? "").slice(0, 200), status, note, updated_by: auth.staff.fullName, updated_at: new Date().toISOString() };
  const { error } = await supabaseAdmin.from("action_plan_follow").upsert(row);
  if (error) {
    console.error("Plan follow-up error:", error);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
  await logAudit(auth.staff, "action_plans", `${store} ${month} ${key}`, before ?? null, { status, note });
  return NextResponse.json({ ok: true });
}
