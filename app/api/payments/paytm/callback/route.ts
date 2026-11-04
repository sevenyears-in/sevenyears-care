import { NextResponse } from "next/server";
import { extendedSettings } from "@/lib/extended-warranty";
import { paytmStatus, paytmVerify } from "@/lib/payment-gateways";
import { finishRedirectPayment, formFields } from "@/lib/payment-finish";
import { siteUrl } from "@/lib/notify";

// POST /api/payments/paytm/callback — Paytm sends the customer back here after paying.

export async function POST(request: Request) {
  const s = await extendedSettings();
  const fields = await formFields(request);
  const orderId = fields.ORDERID ?? "";
  if (!orderId || !paytmVerify(fields, s.paytmKey, fields.CHECKSUMHASH ?? "")) {
    console.error("Paytm callback: bad checksum", orderId);
    return NextResponse.redirect(`${siteUrl()}/?payment=check`, 303);
  }
  // Confirm with Paytm directly before giving the extension.
  const status = await paytmStatus(s, orderId).catch(() => ({ success: false, amount: 0, txnId: null }));
  return finishRedirectPayment({
    orderId,
    success: fields.STATUS === "TXN_SUCCESS" && status.success,
    paymentId: status.txnId ?? fields.TXNID ?? null,
    amount: status.success ? status.amount : null,
  });
}
