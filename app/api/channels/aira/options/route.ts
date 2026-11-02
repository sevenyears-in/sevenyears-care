import { NextResponse } from "next/server";
import { airaGuard } from "@/lib/aira";
import { getStores } from "@/lib/stores";
import { COMPLAINT_CATEGORIES } from "@/lib/site-config";

// GET /api/channels/aira/options — store names and complaint categories for the chatbot's menus.
export async function GET(request: Request) {
  const denied = await airaGuard(request);
  if (denied) return denied;
  const stores = (await getStores()).stores.map((s) => s.name);
  return NextResponse.json({ stores, categories: COMPLAINT_CATEGORIES });
}
