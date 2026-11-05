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
  const n = (v: number) => (v ? v.toLocaleString("en-IN") : <span className="text-black/25">0</span>);

  return (
    <div className="overflow-hidden rounded-3xl bg-white soft-card ring-1 ring-black/5">
      <p className="px-5 pt-4 text-xs font-bold uppercase tracking-wider text-[#ff5e79]">Warranties by store and bill month</p>
      <div className="overflow-x-auto p-2">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-xs uppercase tracking-wider text-black/45">
            <tr>
              <th className="sticky left-0 bg-white px-3 py-2 text-left">Store Name</th>
              {months.map((m) => (
                <th key={m} className="px-3 py-2 text-right">
                  {label(m)}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {stores.map((s) => (
              <tr key={s}>
                <td className="sticky left-0 bg-white px-3 py-2 font-semibold">{s}</td>
                {months.map((m) => (
                  <td key={m} className="px-3 py-2 text-right tabular-nums">
                    {n(get(s, m))}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-bold tabular-nums">{n(storeTotal(s))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black/10 bg-[#f7f9fb] font-bold">
              <td className="sticky left-0 bg-[#f7f9fb] px-3 py-2">Total warranties</td>
              {months.map((m) => (
                <td key={m} className="px-3 py-2 text-right tabular-nums">
                  {n(monthTotal(m))}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums">{n(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
