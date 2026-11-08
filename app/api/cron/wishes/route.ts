import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runWishes } from "@/lib/wishes";
import { alertSettings } from "@/lib/alert-settings";

// GET /api/cron/wishes?key=YOUR_CRON_SECRET — birthday & anniversary wishes (run daily after 8 am).
// Checks every open service request and complaint against its deadlines and
// escalates late ones. Call it every 30 minutes (Hostinger cron job or any
// free "cron job" website). The key is set on Staff → Alerts Setup (or CRON_SECRET).

export async function GET(request: Request) {
  const secret = (await alertSettings()).cronSecret;
  const url = new URL(request.url);
  const given =
    url.searchParams.get("key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "Escalation key is not set (Staff → Alerts Setup)." }, { status: 503 });
  }
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }

  try {
    const result = await runWishes(true);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Wishes run failed:", error);
    return NextResponse.json({ error: "Wishes run failed." }, { status: 500 });
  }
}
