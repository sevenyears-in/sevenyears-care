import { NextResponse } from "next/server";
import { runEscalations } from "@/lib/escalation";
import { runWishes } from "@/lib/wishes";

// GET /api/cron/run — the scheduled job (every 30 minutes): escalates late service requests and
// complaints, and sends today's birthday / anniversary wishes. No key needed: both steps only act
// on what is due (each escalation level and each wish happens once), so extra calls change nothing.
let lastRun = 0;

export async function GET() {
  if (Date.now() - lastRun < 5 * 60_000) return NextResponse.json({ ok: true, skipped: "ran recently" });
  lastRun = Date.now();
  try {
    const escalations = await runEscalations();
    const wishes = await runWishes().catch((e) => {
      console.error("Wishes run failed:", e);
      return null;
    });
    return NextResponse.json({ ok: true, escalations, wishes });
  } catch (error) {
    console.error("Scheduled run failed:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
