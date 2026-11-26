// Short wording for repeated incidents in letters: days and times grouped instead of one line each.
//   daysPhrase(["2026-11-15", …, "2026-11-25"])  → "every day from 15 to 25 Nov 2026"
//   daysPhrase(["2026-11-03", "2026-11-04", "2026-11-09"]) → "on 3, 4 and 9 Nov 2026"
//   timesPhrase(["8:48 am", "8:55 am"]) → "between 8:48 am and 8:55 am"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parts = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
};
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** "3, 4 and 9" */
function joinAnd(list: string[]) {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** The days, as a range when they follow each other, else listed by month. */
export function daysPhrase(dates: string[]): string {
  const ds = [...new Set(dates)].sort();
  if (!ds.length) return "";
  const first = parts(ds[0]);
  const last = parts(ds[ds.length - 1]);
  const consecutive = ds.length >= 3 && (dayMs(ds[ds.length - 1]) - dayMs(ds[0])) / 86_400_000 === ds.length - 1;
  if (consecutive) {
    const from = first.y === last.y && first.m === last.m ? `${first.day}` : first.y === last.y ? `${first.day} ${MONTHS[first.m - 1]}` : `${first.day} ${MONTHS[first.m - 1]} ${first.y}`;
    return `every day from ${from} to ${last.day} ${MONTHS[last.m - 1]} ${last.y}`;
  }
  // Group by month: "on 28 and 30 Nov and 2 Dec 2026"
  const groups: { key: string; y: number; m: number; days: number[] }[] = [];
  for (const d of ds) {
    const p = parts(d);
    const key = `${p.y}-${p.m}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.days.push(p.day);
    else groups.push({ key, y: p.y, m: p.m, days: [p.day] });
  }
  const sameYear = groups.every((g) => g.y === groups[0].y);
  const chunks = groups.map((g, i) => `${joinAnd(g.days.map(String))} ${MONTHS[g.m - 1]}${!sameYear || i === groups.length - 1 ? ` ${g.y}` : ""}`);
  return `on ${joinAnd(chunks)}`;
}

/** "at 10:33 pm" for one time, else "between 8:48 am and 8:55 am". Times as shown by clockIST. */
export function timesPhrase(times: string[]): string {
  const ts = [...new Set(times.filter(Boolean))];
  if (!ts.length) return "";
  if (ts.length === 1) return `at ${ts[0]}`;
  const mins = (t: string) => {
    const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(t.trim());
    if (!m) return 0;
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return h * 60 + Number(m[2]);
  };
  // Times after midnight (late closings) sort after the evening ones.
  const key = (t: string) => {
    const v = mins(t);
    return v < 6 * 60 ? v + 24 * 60 : v;
  };
  const sorted = [...ts].sort((a, b) => key(a) - key(b));
  return `between ${sorted[0]} and ${sorted[sorted.length - 1]}`;
}

/** "1 day" / "11 days" */
export const daysCount = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
