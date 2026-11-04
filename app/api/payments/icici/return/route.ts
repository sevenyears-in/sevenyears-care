import { NextResponse } from "next/server";
import { extendedSettings } from "@/lib/extended-warranty";
import { iciciVerify } from "@/lib/payment-gateways";
import { finishRedirectPayment, formFields } from "@/lib/payment-finish";
import { siteUrl } from "@/lib/notify";

// POST /api/payments/icici/return — ICICI Eazypay sends the customer back here after paying.

export async function POST(request: Request) {
  const s = await extendedSettings();
  const fields = await formFields(request);
  const referenceNo = fields.ReferenceNo ?? "";
  if (!referenceNo || !iciciVerify(fields, s.iciciAesKey)) {
    console.error("ICICI return: bad signature", referenceNo, fields["Response Code"]);
    return NextResponse.redirect(`${siteUrl()}/?payment=check`, 303);
  }
  return finishRedirectPayment({
    orderId: referenceNo,
    success: fields["Response Code"] === "E000",
    paymentId: fields["Unique Ref Number"] ?? null,
    amount: Number(fields["Transaction Amount"] ?? fields["Total Amount"] ?? NaN) || null,
  });
}
