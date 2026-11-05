import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { readFilters } from "@/lib/warranty-search";

// GET /api/staff/warranties/summary?store=&from=&to= → warranties per store per bill month.
export async function GET(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const f = readFilters(request.url);
  const { data, error } = await supabaseAdmin.rpc("warranty_month_summary", {
    p_from: f.from || null,
    p_to: f.to || null,
    p_store: f.store ? f.store.replace(/[%_]/g, "") : null,
  });
  if (error) {
    console.error("Warranty summary error:", error);
    return NextResponse.json({ error: "Summary not available yet." }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}
