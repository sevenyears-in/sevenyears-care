import { after, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { eligibility, extendedSettings, isApprovedInspection, warrantyByToken } from "@/lib/extended-warranty";
import { alertInspectionTeam } from "@/lib/extended-notify";

// POST /api/extend/inspection { token, note? } → the customer asks for the inspection
// needed to buy the extended warranty after the first 10 days.

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { token?: string; note?: string };
    const w = await warrantyByToken(String(body.token ?? ""));
    if (!w) return NextResponse.json({ error: "Warranty not found." }, { status: 404 });
    const s = await extendedSettings();
    const e = await eligibility(w, s);
    if (!e.ok) return NextResponse.json({ error: e.reason }, { status: 409 });
    if (e.request && (e.request.status === "pending_inspection" || isApprovedInspection(e.request))) {
      return NextResponse.json({ error: "A request is already open for this warranty." }, { status: 409 });
    }

    const { error } = await supabaseAdmin.from("warranty_extensions").insert({
      warranty_id: w.id,
      warranty_number: w.warranty_number,
      kind: "inspection",
      status: "pending_inspection",
      price: s.price,
      months: s.months,
      store_name: w.store_name,
      customer_name: w.customer_name,
      customer_mobile: w.customer_mobile,
      product_name: w.product_name,
      customer_note: String(body.note ?? "").trim().slice(0, 500) || null,
    });
    if (error) {
      console.error("Inspection request error:", error);
      return NextResponse.json({ error: "Unable to send the request. Please try again." }, { status: 500 });
    }
    after(() =>
      alertInspectionTeam(
        w,
        "Extended warranty: inspection requested",
        `${w.customer_name} (${w.customer_mobile}) wants to buy the extended warranty — please inspect the product.`
      ).catch((err) => console.error("Inspection alert failed:", err))
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Inspection request error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
