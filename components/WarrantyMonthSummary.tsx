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

  // One soft colour per store; cells get a little stronger as the count goes up.
  const COLOURS = ["#ff5e79", "#8883d7", "#0fa8bf", "#f39237", "#16a34a", "#d946ef"];
  const colour = (i: number) => COLOURS[i % COLOURS.length];
  const max = Math.max(1, ...rows.map((r) => r.total));
  const tint = (v: number, c: string) =>
    v ? { backgroundColor: `${c}${Math.round(14 + (v / max) * 46).toString(16).padStart(2, "0")}` } : undefined;

  const cell = "min-w-[64px] px-2 py-2.5 text-center tabular-nums";

  return (
    <div className="overflow-hidden rounded-3xl bg-white soft-card ring-1 ring-black/5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/5 px-6 py-4">
        <div>
          <p className="text-base font-bold">Warranties by store and bill month</p>
          <p className="text-xs text-black/45">Based on the bill date · follows the store and date filters</p>
        </div>
        <p className="text-2xl font-bold tabular-nums">
          {grand.toLocaleString("en-IN")} <span className="text-xs font-semibold text-black/45">total</span>
        </p>
      </div>
      <div className="overflow-x-auto px-3 py-3">
        <table className="w-full min-w-[600px] border-separate border-spacing-x-1 border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-[11px] font-bold uppercase tracking-wider text-black/45">
              <th className="sticky left-0 z-10 w-40 bg-white px-3 py-2 text-left">Store</th>
              {months.map((m) => (
                <th key={m} className={`${cell} py-2`}>
                  {label(m)}
                </th>
              ))}
              <th className={`${cell} py-2 text-black/70`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((s, i) => (
              <tr key={s}>
                <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2.5 font-semibold">
                  <span className="mr-2.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: colour(i) }} />
                  {s}
                </td>
                {months.map((m) => {
                  const v = get(s, m);
                  return (
                    <td key={m} className={`${cell} rounded-xl font-medium`} style={tint(v, colour(i))}>
                      {n(v)}
                    </td>
                  );
                })}
                <td className={`${cell} rounded-xl font-bold`} style={{ color: colour(i), backgroundColor: `${colour(i)}14` }}>
                  {n(storeTotal(s))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="sticky left-0 z-10 whitespace-nowrap border-t border-black/10 bg-white px-3 py-3">Total</td>
              {months.map((m) => (
                <td key={m} className={`${cell} border-t border-black/10 py-3`}>
                  {n(monthTotal(m))}
                </td>
              ))}
              <td className={`${cell} rounded-xl bg-[#161616] py-3 text-white`}>{n(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
