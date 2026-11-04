import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  canPayNow,
  createRazorpayOrder,
  isApprovedInspection,
  eligibility,
  extendedSettings,
  onlinePaymentsReady,
  warrantyByToken,
} from "@/lib/extended-warranty";

// POST /api/extend/order { token } → starts a Razorpay payment for the extended warranty.

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const w = await warrantyByToken(String(body.token ?? ""));
    if (!w) return NextResponse.json({ error: "Warranty not found." }, { status: 404 });

    const s = await extendedSettings();
    if (!onlinePaymentsReady(s)) {
      return NextResponse.json({ error: "Online payment is not available yet. Please pay at the store." }, { status: 503 });
    }
    const e = await eligibility(w, s);
    if (!e.ok) return NextResponse.json({ error: e.reason }, { status: 409 });
    if (!canPayNow(e)) {
      return NextResponse.json(
        { error: "After 10 days from purchase, a technician inspection is needed before you can buy it." },
        { status: 409 }
      );
    }

    // Reuse the approved inspection (or an unfinished payment started within the first days), else create one.
    const approved = isApprovedInspection(e.request);
    let requestId = approved || (e.mode === "direct" && e.request?.status === "awaiting_payment") ? e.request!.id : null;
    const price = approved ? Number(e.request!.price) : s.price;
    if (!requestId) {
      const { data, error } = await supabaseAdmin
        .from("warranty_extensions")
        .insert({
          warranty_id: w.id,
          warranty_number: w.warranty_number,
          kind: "direct",
          status: "awaiting_payment",
          price,
          months: s.months,
          store_name: w.store_name,
          customer_name: w.customer_name,
          customer_mobile: w.customer_mobile,
          product_name: w.product_name,
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error("Create extension request error:", error);
        return NextResponse.json({ error: "Unable to start the payment. Please try again." }, { status: 500 });
      }
      requestId = data.id;
    }

    const orderId = await createRazorpayOrder(s, price, `EXT-${w.warranty_number}`, {
      warranty: w.warranty_number,
      request: String(requestId),
    });
    await supabaseAdmin.from("warranty_extensions").update({ razorpay_order_id: orderId, price }).eq("id", requestId);

    return NextResponse.json({
      keyId: s.razorpayKeyId,
      orderId,
      amount: Math.round(price * 100),
      name: "Seven Years Care",
      description: `Extended Warranty +${s.months} months · ${w.warranty_number}`,
      prefill: { name: w.customer_name, contact: `+91${w.customer_mobile}` },
    });
  } catch (error) {
    console.error("Extend order error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start the payment." },
      { status: 500 }
    );
  }
}
