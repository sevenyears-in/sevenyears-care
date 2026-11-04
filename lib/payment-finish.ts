// Shared ending for redirect-style payments (Paytm, ICICI): find the request by
// our order / reference number, apply the extension, send the customer back.

import { after, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { applyExtension, warrantyById } from "@/lib/extended-warranty";
import { tellCustomerActive } from "@/lib/extended-notify";
import { siteUrl } from "@/lib/notify";

export async function finishRedirectPayment(input: {
  orderId: string;
  success: boolean;
  paymentId: string | null;
  amount: number | null;
}) {
  const { data: req } = await supabaseAdmin
    .from("warranty_extensions")
    .select("id, warranty_id, price")
    .eq("razorpay_order_id", input.orderId)
    .maybeSingle();
  const w = req ? await warrantyById(String(req.warranty_id)) : null;
  const back = (q: string) =>
    NextResponse.redirect(w ? `${siteUrl()}/extend/${w.verification_token}?${q}` : `${siteUrl()}/?payment=${q}`, 303);

  if (!req || !w) return back("payment=unknown");
  if (!input.success) return back("payment=failed");
  if (input.amount !== null && Math.abs(input.amount - Number(req.price)) > 0.01) {
    console.error("Payment amount mismatch", input.orderId, input.amount, req.price);
    return back("payment=check");
  }
  const result = await applyExtension({ requestId: req.id, paymentMode: "online", paymentId: input.paymentId });
  if (!result.ok) return back("payment=check");
  if (!result.already && result.expiry && result.warranty) {
    const warranty = result.warranty;
    const expiry = result.expiry;
    after(() => tellCustomerActive(warranty, expiry).catch((e) => console.error("Extension message failed:", e)));
  }
  return back("payment=success");
}

export async function formFields(request: Request) {
  const fields: Record<string, string> = {};
  try {
    const form = await request.formData();
    form.forEach((v, k) => {
      fields[k] = String(v);
    });
  } catch {
    // not a form post
  }
  return fields;
}
