import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { istNow } from "@/lib/business-day";
import { canPostWalkins, loadWalkins } from "@/lib/walkins";

// POST { store, count } — today's walk-ins so far (running total for the day).
// The store's CRE, or the Store Manager / ASM / Floor Manager and management.
export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const store = String(b.store ?? "").toUpperCase().slice(0, 60);
  const count = Number(b.count);
  if (!store || !Number.isInteger(count) || count < 0 || count > 10000) return NextResponse.json({ error: "Enter the number of walk-ins (a whole number)." }, { status: 400 });
  if (!(await canPostWalkins(auth.staff, store))) return NextResponse.json({ error: "Only the CRE, Store Manager or management of this store can post walk-ins." }, { status: 403 });
  const day = istNow().date;
  const before = await loadWalkins(store, day);
  const { error } = await supabaseAdmin
    .from("walkin_counts")
    .upsert({ store, day, count, updated_by: auth.staff.id, updated_by_name: auth.staff.fullName, updated_at: new Date().toISOString() });
  if (error) {
    console.error("Walk-ins save error:", error);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
  await logAudit(auth.staff, "walkins", `${store} ${day}`, before ? { count: before.count, by: before.updated_by_name } : null, { count });
  return NextResponse.json({ ok: true, day, count });
}
