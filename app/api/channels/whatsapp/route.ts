import { createHmac } from "node:crypto";
import { after, NextResponse } from "next/server";
import { channelSettings, sameSecret } from "@/lib/channel-settings";
import { handleWhatsAppMessage } from "@/lib/whatsapp-bot";

// WhatsApp Cloud API webhook (Meta → Seven Years Care).
// GET  → one-time check when the webhook is connected in Meta
// POST → incoming messages; customers can register complaints by chatting.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const settings = await channelSettings(true);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";

  if (mode === "subscribe" && sameSecret(token, settings.waVerifyToken)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

type WaMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
};

export async function POST(request: Request) {
  const raw = await request.text();
  const settings = await channelSettings();

  // Check the message really comes from Meta (when the app secret is set).
  if (settings.waAppSecret) {
    const given = request.headers.get("x-hub-signature-256") ?? "";
    const expected = `sha256=${createHmac("sha256", settings.waAppSecret).update(raw).digest("hex")}`;
    if (!sameSecret(given, expected)) return new Response("Bad signature", { status: 401 });
  }

  if (!settings.waEnabled) return NextResponse.json({ ok: true, ignored: "disabled" });

  let body: {
    entry?: { changes?: { value?: { messages?: WaMessage[]; contacts?: { profile?: { name?: string }; wa_id?: string }[] } }[] }[];
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const jobs: { mobile: string; text: string; messageId: string; profileName?: string }[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const profileName = value.contacts?.[0]?.profile?.name;
      for (const m of value.messages ?? []) {
        const from = String(m.from ?? "").replace(/\D/g, "");
        if (!from.startsWith("91") || from.length !== 12) continue; // Indian numbers only
        const text =
          m.text?.body ??
          m.button?.text ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          "";
        jobs.push({
          mobile: from.slice(-10),
          text: text || "(not text)",
          messageId: String(m.id ?? ""),
          profileName,
        });
      }
    }
  }

  // Reply to Meta straight away; handle the conversation afterwards.
  after(async () => {
    for (const job of jobs) {
      try {
        if (job.text === "(not text)") job.text = "menu";
        await handleWhatsAppMessage(job);
      } catch (error) {
        console.error("WhatsApp bot error:", error);
      }
    }
  });

  return NextResponse.json({ ok: true });
}
