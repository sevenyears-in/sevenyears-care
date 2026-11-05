"use client";

import { useEffect, useState } from "react";

type Row = { store_name: string; month: string; total: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}-${ym.slice(2, 4)}`;

/** Every month from the first to the last (so empty months still show). */
function monthRange(first: string, last: string) {
  const out: string[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  while (`${y}-${String(m).padStart(2, "0")}` <= last && out.length < 60) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Store × bill month table (with totals) for the Warranties page. Follows the store and date filters. */
export function WarrantyMonthSummary({ query }: { query: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setError("");
    fetch(`/api/staff/warranties/summary?${query}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) setError(d.error || "Summary not available.");
        else setRows((d.rows ?? []).map((x: Row) => ({ ...x, total: Number(x.total) })));
      })
      .catch(() => live && setError("Summary not available."));
    return () => {
      live = false;
    };
  }, [query]);

  if (error) return null;
  if (!rows) return <div className="h-32 animate-pulse rounded-3xl bg-white soft-card ring-1 ring-black/5" />;
  if (rows.length === 0) return null;

  const present = [...new Set(rows.map((r) => r.month))].sort();
  const months = monthRange(present[0], present[present.length - 1]);
  const stores = [...new Set(rows.map((r) => r.store_name))].sort();
  const get = (s: string, m: string) => rows.find((r) => r.store_name === s && r.month === m)?.total ?? 0;
  const storeTotal = (s: string) => rows.filter((r) => r.store_name === s).reduce((a, r) => a + r.total, 0);
  const monthTotal = (m: string) => rows.filter((r) => r.month === m).reduce((a, r) => a + r.total, 0);
  const grand = rows.reduce((a, r) => a + r.total, 0);
  const n = (v: number) => (v ? v.toLocaleString("en-IN") : <span className="text-black/20">–</span>);

  // Logo colours, one per store; cells shaded by how many warranties (heat map).
  const COLOURS = ["#ff5e79", "#8883d7", "#f39237", "#0fa8bf", "#16a34a", "#d946ef"];
  const colour = (i: number) => COLOURS[i % COLOURS.length];
  const max = Math.max(1, ...rows.map((r) => r.total));
  const cellStyle = (v: number, c: string) =>
    v ? { backgroundColor: `${c}${Math.round(18 + (v / max) * 70).toString(16).padStart(2, "0")}` } : undefined;
  const monthMax = Math.max(1, ...months.map(monthTotal));

  return (
    <div className="overflow-hidden rounded-3xl bg-white soft-card ring-1 ring-black/5">
      <div className="h-1.5 w-full bg-[linear-gradient(90deg,#ff5e79,#8883d7,#f39237,#0fa8bf)]" aria-hidden />
      <div className="flex flex-wrap items-end justify-between gap-2 px-5 pt-4">
        <p className="text-sm font-bold">
          <span className="bg-[linear-gradient(90deg,#ff5e79,#8883d7)] bg-clip-text text-transparent">Warranties by store and bill month</span>
        </p>
        <p className="text-xs text-black/45">Darker = more warranties</p>
      </div>
      <div className="overflow-x-auto p-3">
        <table className="w-full min-w-[560px] border-separate border-spacing-1 text-sm">
          <thead>
            <tr className="text-xs font-bold uppercase tracking-wider text-white">
              <th className="sticky left-0 rounded-xl bg-[#161616] px-3 py-2 text-left">Store Name</th>
              {months.map((m, i) => (
                <th key={m} className="rounded-xl px-3 py-2 text-right" style={{ backgroundColor: colour(i + 1) }}>
                  {label(m)}
                </th>
              ))}
              <th className="rounded-xl bg-[#161616] px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((s, i) => (
              <tr key={s}>
                <td className="sticky left-0 rounded-xl bg-white px-3 py-2 font-semibold">
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: colour(i) }} />
                  {s}
                </td>
                {months.map((m) => {
                  const v = get(s, m);
                  return (
                    <td key={m} className="rounded-xl px-3 py-2 text-right font-semibold tabular-nums" style={cellStyle(v, colour(i))}>
                      {n(v)}
                    </td>
                  );
                })}
                <td className="rounded-xl px-3 py-2 text-right font-bold tabular-nums text-white" style={{ backgroundColor: colour(i) }}>
                  {n(storeTotal(s))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="sticky left-0 rounded-xl bg-[#f7f9fb] px-3 py-2">Total warranties</td>
              {months.map((m) => (
                <td key={m} className="rounded-xl bg-[#f7f9fb] px-3 pb-1 pt-2 text-right tabular-nums">
                  {n(monthTotal(m))}
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/5">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#8883d7,#0fa8bf)]"
                      style={{ width: `${(monthTotal(m) / monthMax) * 100}%` }}
                    />
                  </div>
                </td>
              ))}
              <td className="rounded-xl bg-[#161616] px-3 py-2 text-right tabular-nums text-white">{n(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
