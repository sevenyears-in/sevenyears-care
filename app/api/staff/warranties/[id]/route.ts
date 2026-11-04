import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { NOT_RECORDED } from "@/lib/zoho-import";

// PATCH /api/staff/warranties/:id — fill in model / serial / address on a
// warranty imported from Zoho (only while they still say "Not recorded").

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const modelNumber = String(body.modelNumber ?? "").trim();
  const serialNumber = String(body.serialNumber ?? "").trim();
  const address = String(body.customerAddress ?? "").trim();

  const { data: w } = await supabaseAdmin
    .from("warranties")
    .select("id, serial_number, customer_address")
    .eq("id", id)
    .maybeSingle();
  if (!w) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (w.serial_number !== NOT_RECORDED && w.customer_address !== NOT_RECORDED) {
    return NextResponse.json({ error: "These details are already filled in." }, { status: 400 });
  }

  const update: Record<string, string> = {};
  if (w.serial_number === NOT_RECORDED) {
    if (!modelNumber || !serialNumber) {
      return NextResponse.json({ error: "Enter the model number and serial number." }, { status: 400 });
    }
    if (serialNumber.toLowerCase() === NOT_RECORDED.toLowerCase()) {
      return NextResponse.json({ error: "Enter the real serial number." }, { status: 400 });
    }
    const { data: used } = await supabaseAdmin
      .from("warranties")
      .select("warranty_number")
      .ilike("serial_number", serialNumber)
      .neq("id", id)
      .limit(1);
    if (used && used.length > 0) {
      return NextResponse.json({ error: `Serial number already registered (${used[0].warranty_number}).` }, { status: 400 });
    }
    update.model_number = modelNumber;
    update.serial_number = serialNumber;
  }
  if (w.customer_address === NOT_RECORDED && address.length >= 5) update.customer_address = address;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

  const { error } = await supabaseAdmin.from("warranties").update(update).eq("id", id);
  if (error) {
    console.error("Update warranty details error:", error);
    return NextResponse.json({ error: "Unable to save." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
