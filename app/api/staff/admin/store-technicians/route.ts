import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getStores, matchStore } from "@/lib/stores";
import { loadStoreTechnicians, saveStoreTechnicians } from "@/lib/store-technicians";
import { ROLE_LABELS, asRole } from "@/lib/roles";

// Admin: who does the technician work at each store.
// GET → { stores: [{ name, staffId }], people: [{ id, fullName, role, storeName }] }
// PUT → { storeName, staffId }  (staffId "" = no default)

export async function GET() {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;

  const [storeList, map, { data: people }] = await Promise.all([
    getStores(),
    loadStoreTechnicians(),
    supabaseAdmin
      .from("staff_users")
      .select("id, full_name, role, store_name")
      .eq("is_active", true)
      .in("role", ["technician", "service_head"])
      .order("full_name"),
  ]);

  const names = new Set(storeList.stores.map((s) => s.name.toLowerCase()));
  const stores = [
    ...storeList.stores.map((s) => ({ name: s.name, staffId: map[s.name.toLowerCase()]?.staffId ?? "" })),
    // keep settings for stores Zoho no longer lists, so they can be cleared
    ...Object.values(map)
      .filter((e) => !names.has(e.storeName.toLowerCase()))
      .map((e) => ({ name: e.storeName, staffId: e.staffId })),
  ];

  return NextResponse.json({
    stores,
    people: (people ?? []).map((p) => ({
      id: String(p.id),
      fullName: String(p.full_name),
      role: ROLE_LABELS[asRole(p.role)],
      storeName: p.store_name ? String(p.store_name) : null,
    })),
  });
}

export async function PUT(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { storeName?: string; staffId?: string };
  const storeName = String(body.storeName ?? "").trim();
  const staffId = String(body.staffId ?? "").trim();
  if (!storeName) return NextResponse.json({ error: "Choose a store." }, { status: 400 });

  const map = await loadStoreTechnicians();
  const key = storeName.toLowerCase();

  if (!staffId) {
    delete map[key];
  } else {
    const store = matchStore((await getStores()).stores, storeName);
    if (!store && !map[key]) return NextResponse.json({ error: "Unknown store." }, { status: 400 });
    const { data: person } = await supabaseAdmin
      .from("staff_users")
      .select("id, role, is_active")
      .eq("id", staffId)
      .maybeSingle();
    if (!person || !person.is_active || !["technician", "service_head"].includes(String(person.role))) {
      return NextResponse.json({ error: "Choose an active Technician or Service Head." }, { status: 400 });
    }
    map[key] = { storeName: store?.name ?? map[key].storeName, staffId };
  }

  try {
    await saveStoreTechnicians(map);
  } catch (error) {
    console.error("Save store technicians error:", error);
    return NextResponse.json({ error: "Unable to save." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
