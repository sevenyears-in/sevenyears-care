import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { extendedSettings, gatewayConfigured, saveExtendedSettings, type Gateway } from "@/lib/extended-warranty";
import { siteUrl } from "@/lib/notify";

// Super Admin: extended warranty price + online payment (Razorpay / Paytm / ICICI Eazypay).
// GET → settings (secret keys are never sent back — only whether they are saved)
// PUT → any of the fields below

function view(s: Awaited<ReturnType<typeof extendedSettings>>) {
  const site = siteUrl();
  return {
    price: s.price,
    months: s.months,
    windowDays: s.windowDays,
    onlineEnabled: s.onlineEnabled,
    gateway: s.gateway,
    ready: {
      razorpay: gatewayConfigured(s, "razorpay"),
      paytm: gatewayConfigured(s, "paytm"),
      icici: gatewayConfigured(s, "icici"),
    },
    razorpayKeyId: s.razorpayKeyId,
    keySecretSet: Boolean(s.razorpayKeySecret),
    webhookSecretSet: Boolean(s.razorpayWebhookSecret),
    testMode: s.gateway === "razorpay" ? s.razorpayKeyId.startsWith("rzp_test_") : s.gateway === "paytm" ? s.paytmStaging : false,
    webhookUrl: `${site}/api/payments/razorpay/webhook`,
    paytmMid: s.paytmMid,
    paytmKeySet: Boolean(s.paytmKey),
    paytmWebsite: s.paytmWebsite,
    paytmStaging: s.paytmStaging,
    paytmCallbackUrl: `${site}/api/payments/paytm/callback`,
    iciciMerchantId: s.iciciMerchantId,
    iciciSubMerchantId: s.iciciSubMerchantId,
    iciciKeySet: Boolean(s.iciciAesKey),
    iciciPaymode: s.iciciPaymode,
    iciciReturnUrl: `${site}/api/payments/icici/return`,
  };
}

export async function GET() {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  return NextResponse.json(view(await extendedSettings()));
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function PUT(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const s = await extendedSettings();

  if (body.price !== undefined) {
    const price = Math.round(Number(body.price));
    if (!Number.isFinite(price) || price < 1 || price > 100000) return bad("Enter a price between ₹1 and ₹1,00,000.");
    s.price = price;
  }

  // Razorpay
  const keyId = text(body.razorpayKeyId);
  if (keyId !== undefined) {
    if (keyId && !/^rzp_(test|live)_[A-Za-z0-9]{8,}$/.test(keyId)) {
      return bad("The Razorpay Key ID should look like rzp_live_XXXXXXXX (or rzp_test_… for testing).");
    }
    s.razorpayKeyId = keyId;
  }
  if (text(body.razorpayKeySecret)) s.razorpayKeySecret = text(body.razorpayKeySecret)!;
  if (text(body.razorpayWebhookSecret)) s.razorpayWebhookSecret = text(body.razorpayWebhookSecret)!;

  // Paytm
  if (text(body.paytmMid) !== undefined) s.paytmMid = text(body.paytmMid)!;
  if (text(body.paytmKey)) {
    const key = text(body.paytmKey)!;
    if (![16, 24, 32].includes(Buffer.from(key).length)) return bad("The Paytm Merchant Key is usually 16 characters — please check it.");
    s.paytmKey = key;
  }
  if (text(body.paytmWebsite) !== undefined) s.paytmWebsite = text(body.paytmWebsite)! || "DEFAULT";
  if (typeof body.paytmStaging === "boolean") s.paytmStaging = body.paytmStaging;

  // ICICI Eazypay
  if (text(body.iciciMerchantId) !== undefined) s.iciciMerchantId = text(body.iciciMerchantId)!;
  if (text(body.iciciSubMerchantId) !== undefined) s.iciciSubMerchantId = text(body.iciciSubMerchantId)!;
  if (text(body.iciciAesKey)) {
    const key = text(body.iciciAesKey)!;
    if (Buffer.from(key).length < 16) return bad("The ICICI encryption (AES) key should be 16 characters.");
    s.iciciAesKey = key;
  }
  if (text(body.iciciPaymode) !== undefined) s.iciciPaymode = text(body.iciciPaymode)! || "9";

  if (typeof body.gateway === "string") {
    if (!["razorpay", "paytm", "icici"].includes(body.gateway)) return bad("Unknown payment company.");
    s.gateway = body.gateway as Gateway;
  }
  if (typeof body.onlineEnabled === "boolean") s.onlineEnabled = body.onlineEnabled;
  if (s.onlineEnabled && !gatewayConfigured(s)) {
    return bad("Fill in and save the details of the selected payment company before turning online payment on.");
  }

  try {
    await saveExtendedSettings(s);
  } catch (error) {
    console.error("Save extended settings error:", error);
    return NextResponse.json({ error: "Unable to save." }, { status: 500 });
  }
  return NextResponse.json(view(s));
}
