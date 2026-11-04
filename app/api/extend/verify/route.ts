import { after, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { applyExtension, extendedSettings, validPaymentSignature, warrantyByToken } from "@/lib/extended-warranty";
import { tellCustomerActive } from "@/lib/extended-notify";

// POST /api/extend/verify { token, razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Called by the browser after Razorpay Checkout succeeds. The signature proves the payment is real.

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, string>;
    const w = await warrantyByToken(String(body.token ?? ""));
    if (!w) return NextResponse.json({ error: "Warranty not found." }, { status: 404 });
    const s = await extendedSettings();
    const orderId = String(body.razorpay_order_id ?? "");
    const paymentId = String(body.razorpay_payment_id ?? "");
    if (!orderId || !paymentId || !validPaymentSignature(s, orderId, paymentId, String(body.razorpay_signature ?? ""))) {
      return NextResponse.json({ error: "We couldn't confirm this payment. If money was deducted, contact the store." }, { status: 400 });
    }
    const { data: req } = await supabaseAdmin
      .from("warranty_extensions")
      .select("id")
      .eq("razorpay_order_id", orderId)
      .eq("warranty_id", w.id)
      .maybeSingle();
    if (!req) return NextResponse.json({ error: "Payment not linked to this warranty." }, { status: 404 });

    const result = await applyExtension({ requestId: req.id, paymentMode: "online", paymentId });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    if (!result.already && result.expiry && result.warranty) {
      const warranty = result.warranty;
      const expiry = result.expiry;
      after(() => tellCustomerActive(warranty, expiry).catch((e) => console.error("Extension message failed:", e)));
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Extend verify error:", error);
    return NextResponse.json({ error: "Something went wrong. If money was deducted, contact the store." }, { status: 500 });
  }
}
