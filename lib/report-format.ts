// The store report layout used by the sales updates (every 3 hours) and the closing report, in the
// format the stores already post:
//
//   PERAMBRA · 12-11-2026 · 12:00 pm
//   Day target: ₹1,33,333 | Required today: ₹1,69,847
//   Achieved: ₹2,420 (2%) | Bills: 3 | ABV: ₹807
//   Pace: behind by ₹31,776 for this hour            (updates only)
//   MTD: ₹7,75,334 of ₹40,00,000 (19%) | Month backlog: ₹6,93,753
//   Walk-ins: 25 | Conversion: 12%
//
// Day target = month target ÷ days in the month (the same every day).
// Required today = what is still needed for the month ÷ days left including today.
// Month backlog = what should have been sold by now (by the end of yesterday for updates during the day,
// by the end of today for the closing report) − what was sold. Negative = ahead.

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const pctOf = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
export const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
export const clock = (m: number) => {
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

export type StoreFigures = {
  store: string;
  day: string;
  /** "12:00 pm", or "Closing". */
  when: string;
  closing: boolean;
  monthTarget: number;
  daysInMonth: number;
  /** Days of the month up to and including `day`. */
  dayOfMonth: number;
  net: number;
  bills: number;
  /** Month to date including `day`. */
  mtd: number | null;
  /** Time-based pace for updates during the day (null in the closing report or before opening). */
  paceShort: number | null;
  walkins: number | null;
};

export function figuresMath(f: StoreFigures) {
  const dayTarget = f.monthTarget > 0 ? f.monthTarget / f.daysInMonth : 0;
  const before = f.mtd === null ? null : f.mtd - f.net;
  const daysLeftInclToday = f.daysInMonth - f.dayOfMonth + 1;
  const required = f.monthTarget > 0 && before !== null ? Math.max(0, (f.monthTarget - before) / Math.max(1, daysLeftInclToday)) : null;
  const expectedDays = f.closing ? f.dayOfMonth : f.dayOfMonth - 1;
  const backlog = f.monthTarget > 0 && f.mtd !== null ? (f.monthTarget * expectedDays) / f.daysInMonth - (f.closing ? f.mtd : (before ?? 0)) : null;
  const conversion = f.walkins && f.walkins > 0 ? f.bills / f.walkins : null;
  return { dayTarget, required, backlog, conversion, abv: f.bills ? f.net / f.bills : 0 };
}

/** The lines of the report for one store. */
export function storeReportLines(f: StoreFigures): string[] {
  const m = figuresMath(f);
  const lines = [`${f.store} · ${dmy(f.day)} · ${f.when}`];
  if (m.dayTarget > 0) lines.push(`Day target: ${inr(m.dayTarget)}${m.required !== null ? ` | Required today: ${inr(m.required)}` : ""}`);
  lines.push(`Achieved: ${inr(f.net)}${m.dayTarget > 0 ? ` (${pctOf(f.net, m.dayTarget)})` : ""} | Bills: ${f.bills} | ABV: ${f.bills ? inr(m.abv) : "—"}`);
  if (!f.closing && f.paceShort !== null) lines.push(f.paceShort > 0 ? `Pace: behind by ${inr(f.paceShort)} for this hour` : `Pace: on pace for this hour`);
  if (f.mtd !== null && f.monthTarget > 0) {
    const b = m.backlog ?? 0;
    lines.push(`MTD: ${inr(f.mtd)} of ${inr(f.monthTarget)} (${pctOf(f.mtd, f.monthTarget)}) | ${b >= 0 ? `Month backlog: ${inr(b)}` : `Ahead of plan by ${inr(-b)}`}`);
  }
  lines.push(
    f.walkins === null
      ? `Walk-ins: not posted by the CRE | Conversion: —`
      : `Walk-ins: ${f.walkins} | Conversion: ${m.conversion === null ? "—" : `${Math.round(m.conversion * 100)}%`}`
  );
  return lines;
}
