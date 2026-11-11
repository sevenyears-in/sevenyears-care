import { NextResponse } from "next/server";
import { runEscalations } from "@/lib/escalation";
import { runWishes } from "@/lib/wishes";
import { syncRecentSales } from "@/lib/sales-sync";
import { inNightWindow } from "@/lib/sales-backfill";
import { nightTick } from "@/lib/night-jobs";

// GET /api/cron/run — the scheduled job (every 30 minutes): escalates late service requests and
// complaints, and sends today's birthday / anniversary wishes, and copies new bills / returns from Zoho POS. No key needed: both steps only act
// on what is due (each escalation level and each wish happens once), so extra calls change nothing.
let lastRun = 0;

export async function GET() {
  // 11:30–11:59 pm: also start the night copy of earlier months (runs in the background, once at a time).
  if (inNightWindow()) void nightTick().catch(() => undefined);
  if (Date.now() - lastRun < 5 * 60_000) return NextResponse.json({ ok: true, skipped: "ran recently" });
  lastRun = Date.now();
  try {
    const escalations = await runEscalations();
    const wishes = await runWishes().catch((e) => {
      console.error("Wishes run failed:", e);
      return null;
    });
    // Bills and returns from Zoho POS for the sales performance dashboard.
    const sales = await syncRecentSales().catch((e) => {
      console.error("Sales sync failed:", e);
      return null;
    });
    return NextResponse.json({ ok: true, escalations, wishes, sales: sales?.map((d) => ({ date: d.date, bills: d.bills, pending: d.pending })) ?? null });
  } catch (error) {
    console.error("Scheduled run failed:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
