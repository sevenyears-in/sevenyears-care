import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { attendanceCode } from "@/lib/attendance";
import { logAudit } from "@/lib/audit";
import { addKeyHolder, loadKeyHolders, removeKeyHolder } from "@/lib/store-keyholders";
import { openCloseStores } from "@/lib/store-open-close";

// Who else may open / close a store (Super Admin).
// GET → { list, stores, staff }; POST { action: "add", store, code, kinds, from, to, note } | { action: "remove", id }

const isDay = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

export async function GET() {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const [list, stores, { data: staff }] = await Promise.all([
    loadKeyHolders(true),
    openCloseStores(),
    supabaseAdmin.from("staff_users").select("user_id, full_name, store_name").eq("is_active", true).order("full_name"),
  ]);
  return NextResponse.json({
    list,
    stores,
    staff: ((staff ?? []) as { user_id: string; full_name: string; store_name: string | null }[]).map((s) => ({ code: attendanceCode(s.user_id), name: s.full_name, store: s.store_name })),
  });
}

export async function POST(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === "remove") {
    const id = String(body.id ?? "");
    const before = (await loadKeyHolders(true)).find((k) => k.id === id);
    if (!before) return NextResponse.json({ error: "Not found." }, { status: 404 });
    await removeKeyHolder(id);
    await logAudit(auth.staff, "store_keyholders", "remove", before, null).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }
  if (body.action !== "add") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const store = String(body.store ?? "").trim().toUpperCase();
  // One or more people (codes), each saved as its own permission.
  const codes = [...new Set((Array.isArray(body.codes) ? body.codes : [body.code]).map((c) => attendanceCode(c)).filter(Boolean))];
  const kinds = (Array.isArray(body.kinds) ? body.kinds : []).filter((k): k is "open" | "close" => k === "open" || k === "close");
  const from = isDay(body.from) ? String(body.from) : null;
  const to = isDay(body.to) ? String(body.to) : null;
  if (!store) return NextResponse.json({ error: "Choose the store." }, { status: 400 });
  if (!codes.length) return NextResponse.json({ error: "Choose at least one person." }, { status: 400 });
  if (!kinds.length) return NextResponse.json({ error: "Tick opening, closing or both." }, { status: 400 });
  if (from && to && to < from) return NextResponse.json({ error: "The To date is before the From date." }, { status: 400 });
  const { data: who } = await supabaseAdmin.from("staff_users").select("user_id, full_name").eq("is_active", true);
  const staff = (who ?? []) as { user_id: string; full_name: string }[];
  const people = codes.map((code) => ({ code, person: staff.find((s) => attendanceCode(s.user_id) === code) }));
  const missing = people.find((p) => !p.person);
  if (missing) return NextResponse.json({ error: `No active staff member has User ID ${missing.code}.` }, { status: 400 });
  const note = String(body.note ?? "").trim().slice(0, 200);
  for (const p of people) {
    const item = await addKeyHolder({ store, code: p.code, name: p.person!.full_name, kinds, from, to, note, by: auth.staff.fullName });
    await logAudit(auth.staff, "store_keyholders", "add", null, item).catch(() => undefined);
  }
  return NextResponse.json({ ok: true, added: people.length });
}
