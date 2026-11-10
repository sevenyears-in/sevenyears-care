import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { monthReport } from "@/lib/performance";
import { groupName, isMonth } from "@/lib/performance-rules";

// GET /api/staff/performance/export?m=YYYY-MM&store=VATAKARA — payout sheet as CSV (Admins).
export async function GET(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const month = url.searchParams.get("m") ?? "";
  if (!isMonth(month)) return NextResponse.json({ error: "Choose a month." }, { status: 400 });
  const wanted = (url.searchParams.get("store") ?? "").toUpperCase();
  const report = await monthReport(month, true);
  const stores = report.stores.filter((s) => !wanted || s.store === wanted);
  const labels = report.settings.groupLabels;

  // One column per incentive that anyone earned or could earn this month.
  const ruleCols = new Map<string, string>();
  for (const s of stores) for (const p of s.people) for (const l of p.lines) if (!ruleCols.has(l.ruleId)) ruleCols.set(l.ruleId, l.name);

  const r = (n: number) => String(Math.round(n));
  const head = [
    "Store", "Code", "Name", "Group", "Bills", "Items", "Sales before discount", "Discount", "Returns", "Net sales",
    "Target", "Achievement %", "ABV", "Bills over discount limit", "Duties", "Days without punching data", "Duties needed", "Attendance % paid",
    "Store share", ...[...ruleCols.values()], "Before attendance", "Attendance cut", "Total incentive",
  ];
  const lines: string[][] = [head];
  for (const s of stores) {
    for (const p of s.people) {
      const byRule = new Map(p.lines.map((l) => [l.ruleId, l.amount]));
      lines.push([
        s.store, p.userId, p.name, groupName(p.group, labels), String(p.bills), String(p.units), r(p.gross), r(p.discount), r(p.returns), r(p.net),
        p.target ? r(p.target) : "", p.achievement === null ? "" : (p.achievement * 100).toFixed(1), r(p.abv), String(p.flaggedBills),
        p.attendance.found ? String(p.attendance.duties) : "", String(p.attendance.noData), String(p.attendance.required),
        p.attendance.found ? String(Math.round(p.attendance.share * 100)) : "", r(p.storeShare),
        ...[...ruleCols.keys()].map((id) => (byRule.has(id) ? r(byRule.get(id) ?? 0) : "")),
        r(p.earnedBeforeAttendance), r(p.attendanceCut), r(p.total),
      ]);
    }
    lines.push([]);
    lines.push([s.store, "", "STORE", "", String(s.bills), "", r(s.gross), r(s.discount), r(s.returns), r(s.net), r(s.target), (s.achievement * 100).toFixed(1), "", String(s.flagged.length), "", "", "", "", `Pool ${r(s.pool)}`]);
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
