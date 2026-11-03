import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { channelSettings, randomKey, saveChannelSettings } from "@/lib/channel-settings";
import { whatsappConfigured, siteUrl } from "@/lib/notify";

// Super Admin: complaint channels (WhatsApp bot + Sevi chatbot).
// GET → settings (the app secret is never sent back)
// PUT → { waEnabled?, airaEnabled?, waAppSecret?, clearWaAppSecret?, newVerifyToken?, newAiraKey? }

async function view() {
  const s = await channelSettings(true);
  return {
    waEnabled: s.waEnabled,
    waVerifyToken: s.waVerifyToken,
    waAppSecretSaved: Boolean(s.waAppSecret),
    waWebhookUrl: `${siteUrl()}/api/channels/whatsapp`,
    whatsappReady: await whatsappConfigured(),
    airaEnabled: s.airaEnabled,
    airaApiKey: s.airaApiKey,
    airaBaseUrl: `${siteUrl()}/api/channels/sevi`,
  };
}

export async function GET() {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  return NextResponse.json(await view());
}

export async function PUT(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const s = await channelSettings(true);

  if (typeof body.waEnabled === "boolean") s.waEnabled = body.waEnabled;
  if (typeof body.airaEnabled === "boolean") s.airaEnabled = body.airaEnabled;
  const secret = String(body.waAppSecret ?? "").trim();
  if (secret) {
    if (!/^[a-f0-9]{16,64}$/i.test(secret)) {
      return NextResponse.json({ error: "The App secret is the 32-character code from Meta → App settings → Basic." }, { status: 400 });
    }
    s.waAppSecret = secret;
  }
  if (body.clearWaAppSecret === true) s.waAppSecret = "";
  if (body.newVerifyToken === true || (s.waEnabled && !s.waVerifyToken)) s.waVerifyToken = randomKey(18);
  if (body.newAiraKey === true || (s.airaEnabled && !s.airaApiKey)) s.airaApiKey = `sevi_${randomKey(24)}`;

  try {
    await saveChannelSettings(s);
  } catch (error) {
    console.error("Save channel settings error:", error);
    return NextResponse.json({ error: "Unable to save." }, { status: 500 });
  }
  return NextResponse.json({ success: true, settings: await view() });
}
