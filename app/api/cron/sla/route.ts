import { NextResponse } from "next/server";
import { runEscalations } from "@/lib/escalation";

// GET /api/cron/sla?key=YOUR_CRON_SECRET
// Checks every open service request and complaint against its deadlines and
// escalates late ones. Call it every 30 minutes (Hostinger cron job or any
// free "cron job" website). CRON_SECRET must be set in the environment.

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const url = new URL(request.url);
  const given =
    url.searchParams.get("key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "CRON_SECRET is not set (16+ characters)." }, { status: 503 });
  }
  if (given !== secret) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }

  try {
    const result = await runEscalations();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Escalation run failed:", error);
    return NextResponse.json({ error: "Escalation run failed." }, { status: 500 });
  }
}
