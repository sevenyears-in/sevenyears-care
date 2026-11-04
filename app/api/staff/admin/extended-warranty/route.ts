import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { extendedSettings, saveExtendedSettings } from "@/lib/extended-warranty";
import { siteUrl } from "@/lib/notify";

// Super Admin: extended warranty price + Razorpay keys.
// GET → settings (secrets never sent back, only whether they are set)
// PUT → { price?, onlineEnabled?, razorpayKeyId?, razorpayKeySecret?, razorpayWebhookSecret? }

function view(s: Awaited<ReturnType<typeof extendedSettings>>) {
  return {
    price: s.price,
    months: s.months,
    windowDays: s.windowDays,
    onlineEnabled: s.onlineEnabled,
    razorpayKeyId: s.razorpayKeyId,
    keySecretSet: Boolean(s.razorpayKeySecret),
    webhookSecretSet: Boolean(s.razorpayWebhookSecret),
    testMode: s.razorpayKeyId.startsWith("rzp_test_"),
    webhookUrl: `${siteUrl()}/api/payments/razorpay/webhook`,
  };
}

export async function GET() {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  return NextResponse.json(view(await extendedSettings()));
}

export async function PUT(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const s = await extendedSettings();

  if (body.price !== undefined) {
    const price = Math.round(Number(body.price));
    if (!Number.isFinite(price) || price < 1 || price > 100000) {
      return NextResponse.json({ error: "Enter a price between ₹1 and ₹1,00,000." }, { status: 400 });
    }
    s.price = price;
  }
  if (typeof body.razorpayKeyId === "string") {
    const id = body.razorpayKeyId.trim();
    if (id && !/^rzp_(test|live)_[A-Za-z0-9]{8,}$/.test(id)) {
      return NextResponse.json({ error: "The Key ID should look like rzp_live_XXXXXXXX (or rzp_test_… for testing)." }, { status: 400 });
    }
    s.razorpayKeyId = id;
  }
  if (typeof body.razorpayKeySecret === "string" && body.razorpayKeySecret.trim()) s.razorpayKeySecret = body.razorpayKeySecret.trim();
  if (typeof body.razorpayWebhookSecret === "string" && body.razorpayWebhookSecret.trim()) {
    s.razorpayWebhookSecret = body.razorpayWebhookSecret.trim();
  }
  if (typeof body.onlineEnabled === "boolean") {
    if (body.onlineEnabled && !(s.razorpayKeyId && s.razorpayKeySecret)) {
      return NextResponse.json({ error: "Save the Razorpay Key ID and Key Secret first." }, { status: 400 });
    }
    s.onlineEnabled = body.onlineEnabled;
  }
  try {
    await saveExtendedSettings(s);
  } catch (error) {
    console.error("Save extended settings error:", error);
    return NextResponse.json({ error: "Unable to save." }, { status: 500 });
  }
  return NextResponse.json(view(s));
}
