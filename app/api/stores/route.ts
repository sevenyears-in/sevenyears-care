import { NextResponse } from "next/server";
import { getStores } from "@/lib/stores";

// GET /api/stores — store names (from Zoho POS) for the customer forms.
export async function GET() {
  const list = await getStores();
  return NextResponse.json(
    { stores: list.stores.map((s) => ({ name: s.name, code: s.code })) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
