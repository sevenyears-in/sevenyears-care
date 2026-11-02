import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { addManualStore, getStores, removeManualStore } from "@/lib/stores";

// Admin: the store list (Zoho POS + stores added by hand).
// GET ?refresh=1   → read Zoho again now
// POST   { name }  → add a new store that has no Zoho bill yet
// DELETE { name }  → remove a hand-added store
export async function GET(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  return NextResponse.json(await getStores(refresh));
}

export async function POST(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  try {
    const result = await addManualStore(String(body.name ?? ""), auth.staff.fullName);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, name: result.name, list: await getStores() });
  } catch (error) {
    console.error("Add store error:", error);
    return NextResponse.json({ error: "Unable to add the store." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  try {
    await removeManualStore(String(body.name ?? ""));
    return NextResponse.json({ success: true, list: await getStores() });
  } catch (error) {
    console.error("Remove store error:", error);
    return NextResponse.json({ error: "Unable to remove the store." }, { status: 500 });
  }
}
