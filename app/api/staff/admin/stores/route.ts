import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { getStores } from "@/lib/stores";

// Admin: the store list read from Zoho POS. GET ?refresh=1 reads Zoho again now.
export async function GET(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  return NextResponse.json(await getStores(refresh));
}
