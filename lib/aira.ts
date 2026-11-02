// Aira chatbot access check (server only).
import { NextResponse } from "next/server";
import { channelSettings, sameSecret } from "@/lib/channel-settings";

/** null when the request may go ahead, otherwise the error response to return. */
export async function airaGuard(request: Request) {
  const settings = await channelSettings();
  if (!settings.airaEnabled || !settings.airaApiKey) {
    return NextResponse.json({ error: "The Aira channel is turned off." }, { status: 503 });
  }
  const given =
    request.headers.get("x-api-key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!sameSecret(given.trim(), settings.airaApiKey)) {
    return NextResponse.json({ error: "Invalid API key." }, { status: 401 });
  }
  return null;
}
