import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { monthReport } from "@/lib/performance";
import { GROUP_LABEL, isMonth } from "@/lib/performance-rules";

// GET /api/staff/performance/export?m=YYYY-MM&store=VADAKARA — payout sheet as CSV (Admins).
export async function GET(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const month = url.searchParams.get("m") ?? "";
  if (!isMonth(month)) return NextResponse.json({ error: "Choose a month." }, { status: 400 });
  const wanted = (url.searchParams.get("store") ?? "").toUpperCase();
  const report = await monthReport(month, true);
  const stores = report.stores.filter((s) => !wanted || s.store === wanted);

  const r = (n: number) => Math.round(n);
  const head = [
    "Store", "User ID", "Name", "Role", "Group", "Bills", "Items", "Sales before discount", "Discount", "Returns", "Net sales",
    "Target", "Achievement %", "ABV", "Bills over discount limit", "Duties", "Duties needed", "Attendance % paid",
    "Store share", "Individual bonus", "ABV booster", "High value bills", "High value ₹", "WOW bills", "WOW ₹",
    "B2G1 items", "B2G1 ₹", "Slow-moving sold", "Slow-moving ₹", "Before attendance", "Attendance cut", "Total incentive",
  ];
  const lines = [head];
  for (const s of stores) {
    for (const p of s.people) {
      lines.push([
        s.store, p.userId, p.name, p.roleLabel, GROUP_LABEL[p.group], String(p.bills), String(p.units), String(r(p.gross)), String(r(p.discount)),
        String(r(p.returns)), String(r(p.net)), p.target ? String(r(p.target)) : "", p.achievement === null ? "" : (p.achievement * 100).toFixed(1),
        String(r(p.abv)), String(p.flaggedBills), p.attendance.found ? String(p.attendance.duties) : "", String(p.attendance.required),
        p.attendance.found ? String(Math.round(p.attendance.share * 100)) : "", String(r(p.storeShare)), String(r(p.individualBonus)),
        String(r(p.abvBonus)), String(p.spot.highValue.count), String(p.spot.highValue.amount), String(p.spot.wow.count), String(p.spot.wow.amount),
        String(p.spot.b2g1.units), String(p.spot.b2g1.amount), String(r(p.spot.slowMoving.value)), String(p.spot.slowMoving.amount),
        String(r(p.earnedBeforeAttendance)), String(r(p.attendanceCut)), String(r(p.total)),
      ]);
    }
    lines.push([]);
    lines.push([s.store, "", "STORE", "", "", String(s.bills), "", String(r(s.gross)), String(r(s.discount)), String(r(s.returns)), String(r(s.net)), String(r(s.target)), (s.achievement * 100).toFixed(1), "", String(s.flagged.length), "", "", "", `Pool ${r(s.pool)}`]);
    lines.push([]);
  }
  const csv = "﻿" + lines.map((l) => l.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="incentives-${wanted || "all"}-${month}.csv"`,
    },
  });
}
