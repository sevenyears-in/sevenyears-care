import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { applyExtension, extendedSettings, validWebhookSignature } from "@/lib/extended-warranty";
import { tellCustomerActive } from "@/lib/extended-notify";

// POST /api/payments/razorpay/webhook — Razorpay tells us a payment succeeded
// (backup for when the customer closes the page before it finishes).
// Set up in Razorpay Dashboard → Webhooks, events: payment.captured, order.paid.

export async function POST(request: Request) {
  const raw = await request.text();
  const s = await extendedSettings();
  if (!validWebhookSignature(s, raw, request.headers.get("x-razorpay-signature") ?? "")) {
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }
  try {
    const event = JSON.parse(raw) as {
      event?: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string } }; order?: { entity?: { id?: string } } };
    };
    if (event.event !== "payment.captured" && event.event !== "order.paid") return NextResponse.json({ ok: true });
    const payment = event.payload?.payment?.entity;
    const orderId = payment?.order_id ?? event.payload?.order?.entity?.id;
    if (!orderId) return NextResponse.json({ ok: true });

    const { data: req } = await supabaseAdmin.from("warranty_extensions").select("id").eq("razorpay_order_id", orderId).maybeSingle();
    if (!req) return NextResponse.json({ ok: true });
    const result = await applyExtension({ requestId: req.id, paymentMode: "online", paymentId: payment?.id ?? null });
    if (result.ok && !result.already && result.expiry && result.warranty) {
      await tellCustomerActive(result.warranty, result.expiry).catch((e) => console.error("Extension message failed:", e));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Razorpay webhook error:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
