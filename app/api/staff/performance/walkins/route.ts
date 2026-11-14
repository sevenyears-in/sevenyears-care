import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { istNow } from "@/lib/business-day";
import { addWalkin, canPostWalkins, hourlyWalkins, loadWalkins, logManualWalkins } from "@/lib/walkins";

// GET ?store= — today's walk-ins and walk-ins by hour (for the counter screen).
export async function GET(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const store = (new URL(request.url).searchParams.get("store") ?? "").toUpperCase().slice(0, 60);
  if (!store || !(await canPostWalkins(auth.staff, store))) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const day = istNow().date;
  const [w, hourly] = await Promise.all([loadWalkins(store, day), hourlyWalkins(store, day)]);
  return NextResponse.json({ day, count: w?.count ?? 0, updatedAt: w?.updated_at ?? null, hourly });
}

// POST { store, delta: 1 | -1, source, clientId } — one press of the counter.
// POST { store, count } — today's total typed in (the CRE's box). Both: the CRE, SM / ASM / FM or management of the store.
export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const store = String(b.store ?? "").toUpperCase().slice(0, 60);
  if (!store) return NextResponse.json({ error: "Store needed." }, { status: 400 });
  if (!(await canPostWalkins(auth.staff, store))) return NextResponse.json({ error: "Only the CRE, Store Manager or management of this store can post walk-ins." }, { status: 403 });
  const day = istNow().date;
  const by = { id: auth.staff.id, name: auth.staff.fullName };

  if (b.delta !== undefined) {
    const delta = Number(b.delta);
    if (delta !== 1 && delta !== -1) return NextResponse.json({ error: "Bad press." }, { status: 400 });
    const source = ["button", "volume", "remote"].includes(String(b.source)) ? String(b.source) : "button";
    const clientId = typeof b.clientId === "string" && /^[\w-]{8,64}$/.test(b.clientId) ? b.clientId : null;
    try {
      const count = await addWalkin(store, day, delta, by, source, clientId);
      return NextResponse.json({ ok: true, day, count });
    } catch (e) {
      console.error("Walk-in press error:", e);
      return NextResponse.json({ error: "Could not save." }, { status: 500 });
    }
  }

  const count = Number(b.count);
  if (!Number.isInteger(count) || count < 0 || count > 10000) return NextResponse.json({ error: "Enter the number of walk-ins (a whole number)." }, { status: 400 });
  const before = await loadWalkins(store, day);
  const { error } = await supabaseAdmin
    .from("walkin_counts")
    .upsert({ store, day, count, updated_by: auth.staff.id, updated_by_name: auth.staff.fullName, updated_at: new Date().toISOString() });
  if (error) {
    console.error("Walk-ins save error:", error);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
  await logManualWalkins(store, day, count - (before?.count ?? 0), by).catch(() => null);
  await logAudit(auth.staff, "walkins", `${store} ${day}`, before ? { count: before.count, by: before.updated_by_name } : null, { count });
  return NextResponse.json({ ok: true, day, count });
}
