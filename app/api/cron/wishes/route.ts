import { NextResponse } from "next/server";
import { runWishes } from "@/lib/wishes";

// GET /api/cron/wishes — sends today's birthday & anniversary wishes (after 8 am India time).
// No key needed: it only sends wishes that are due today, and each one at most once,
// so calling it often is harmless. Set a daily (or hourly) cron job to call it.
export async function GET() {
  try {
    const result = await runWishes();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Wishes run failed:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
