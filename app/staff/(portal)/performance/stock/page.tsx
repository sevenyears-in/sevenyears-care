import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate, formatDateTime, todayISO } from "@/lib/helpers";
import { monthReport } from "@/lib/performance";
import { rupees } from "@/lib/performance-rules";
import { growth, merchReport, type MerchCategory, type MerchItem } from "@/lib/merch";
import { merchStores } from "@/lib/merch-access";
import { OVERSTOCK_DAYS, REORDER_DAYS } from "@/lib/stock";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock & categories" };

type Search = { store?: string; cat?: string; show?: string; q?: string };

const STORE_COLOURS = ["#0fa8bf", "#f39237", "#ff5e79", "#5b55c9", "#2f9e44"];
const short = (n: number) => (Math.abs(n) >= 100000 ? `₹${(n / 100000).toFixed(2)} L` : rupees(n));
const pc = (x: number | null, digits = 0) => (x === null ? "—" : `${(x * 100).toFixed(digits)}%`);
const days = (x: number | null) => (x === null ? "—" : x > 999 ? "999+" : Math.round(x).toString());
const thc = "whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-black/45";
const tdc = "whitespace-nowrap px-3 py-2 tabular-nums";

function qs(base: Search, change: Partial<Search>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...change })) if (v) p.set(k, String(v));
  const s = p.toString();
  return `/staff/performance/stock${s ? `?${s}` : ""}`;
}

function Growth({ now, before }: { now: number; before: number | null }) {
  const g = growth(now, before);
  if (g === null) return <span className="text-black/30">—</span>;
  return <span className={`font-semibold ${g >= 0 ? "text-green-700" : "text-[#d6224a]"}`}>{g >= 0 ? "▲" : "▼"} {Math.abs(g * 100).toFixed(0)}%</span>;
}

function Tile({ label, value, note, tone = "default" }: { label: string; value: ReactNode; note?: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const ring = tone === "good" ? "ring-green-200" : tone === "warn" ? "ring-amber-200" : tone === "bad" ? "ring-red-200" : "ring-black/5";
  return (
    <div className={`rounded-2xl bg-white p-4 soft-card ring-1 ${ring}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-black/45">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-black/55">{note}</p>}
    </div>
  );
}

const STATUS: Record<MerchItem["status"], { text: string; cls: string }> = {
  out: { text: "Out of stock", cls: "bg-red-100 text-red-800" },
  low: { text: `Under ${REORDER_DAYS} days`, cls: "bg-amber-100 text-amber-800" },
  over: { text: `Over ${OVERSTOCK_DAYS} days`, cls: "bg-[#8883d7]/15 text-[#5b55c9]" },
  ok: { text: "OK", cls: "bg-green-50 text-green-700" },
  no_stock_data: { text: "No stock data", cls: "bg-black/5 text-black/45" },
};

const SHOW: Record<string, { title: string; test: (i: MerchItem) => boolean }> = {
  low: { title: "Fast-moving items running low", test: (i) => i.fast && (i.status === "out" || i.status === "low") },
  out: { title: "Out of stock (sold in the last 60 days)", test: (i) => i.status === "out" },
  reorder: { title: `Under ${REORDER_DAYS} days of cover — reorder`, test: (i) => i.status === "low" || i.status === "out" },
  over: { title: `Over ${OVERSTOCK_DAYS} days of cover — overstock`, test: (i) => i.status === "over" },
  fast: { title: "Fast movers", test: (i) => i.fast },
};

export default async function StockPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  const sp = await searchParams;
  const report = await monthReport(todayISO().slice(0, 7)).catch(() => null);
  const all = (report?.stores ?? []).map((s) => s.store);
  const stores = await merchStores(staff, all);
  if (!stores.length) redirect("/staff/performance");
  const store = stores.includes((sp.store ?? "").toUpperCase()) ? (sp.store ?? "").toUpperCase() : stores[0];
  const base: Search = { store };

  let m;
  try {
    m = await merchReport(store);
  } catch (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Stock &amp; categories</h1>
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          This page is not ready yet ({error instanceof Error ? error.message : "database not set up"}). Please try again later.
        </p>
      </div>
    );
  }
  const t = m.totals;
  const catName = (sp.cat ?? "").toUpperCase();
  const cat = catName ? m.categories.find((c) => c.name === catName) ?? null : null;
  const show = sp.show && SHOW[sp.show] ? sp.show : null;
  const q = (sp.q ?? "").trim().toLowerCase();
  const lowFast = m.items.filter(SHOW.low.test);
  let list: MerchItem[] | null = null;
  if (cat || show || q) {
    list = m.items.filter((i) => (!cat || i.category === cat.name) && (!show || SHOW[show].test(i)) && (!q || i.name.toLowerCase().includes(q) || (i.sku ?? "").toLowerCase().includes(q)));
    if (show === "low" || show === "out" || show === "reorder") list.sort((a, b) => b.units28 - a.units28);
  }
  const fmtRange = (r: [string, string]) => `${formatDate(r[0])} – ${formatDate(r[1])}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">My Performance</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Stock &amp; categories · {store}</h1>
          <p className="mt-1 text-sm text-black/55">
            Sales {fmtRange(m.periods.mtd)} with GST, after returns · Stock {m.stockAt ? `read ${formatDateTime(m.stockAt)}` : "not read yet"}
          </p>
        </div>
        <Link href={`/staff/performance?view=team&store=${encodeURIComponent(store)}`} className="rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-black/5">
          ← Store dashboard
        </Link>
      </div>

      {stores.length > 1 && (
        <div className="flex flex-wrap gap-2 rounded-2xl bg-white p-3 soft-card ring-1 ring-black/5">
          {stores.map((s, i) => {
            const c = STORE_COLOURS[i % STORE_COLOURS.length];
            const on = s === store;
            return (
              <Link key={s} href={qs({}, { store: s })} className="rounded-full px-4 py-1.5 text-sm font-bold ring-1" style={on ? { background: c, color: "#fff" } : { background: `${c}1a`, color: c, boxShadow: `0 0 0 1px ${c}55` }}>
                {s}
              </Link>
            );
          })}
        </div>
      )}

      {lowFast.length > 0 && show !== "low" && (
        <Link href={qs(base, { show: "low" })} className="flex items-center justify-between gap-3 rounded-2xl bg-[#d6224a] px-5 py-4 text-white shadow-md transition hover:opacity-95">
          <span className="text-sm font-bold sm:text-base">⚠ {lowFast.length} fast-moving item(s) are running low or out of stock</span>
          <span className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-sm font-bold">View items →</span>
        </Link>
      )}

      {!m.stockAt && (
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          Stock has not been read yet. It is read from Zoho POS every night at 11:30 pm (or uploaded from Excel in Settings). Sales figures below are already live.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile label="Net sales MTD" value={short(t.net)} note={`${Math.round(t.units)} units`} />
        <Tile label="MoM" value={<Growth now={t.net} before={t.momNet} />} note={t.momNet !== null ? `${short(t.momNet)} · ${fmtRange(m.periods.mom)}` : "Last month not copied yet"} />
        <Tile label="LFL" value={<Growth now={t.net} before={t.lflNet} />} note={t.lflNet !== null ? `${short(t.lflNet)} · ${fmtRange(m.periods.lfl)}` : `Last year not copied yet (${Math.round(m.lflCoverage * 100)}% of days)`} />
        <Tile label="Sell-through" value={pc(t.sellThrough)} note="Sold ÷ (sold + stock)" />
        <Tile label="Stock cover" value={`${days(t.cover)} days`} note={`${Math.round(t.stock)} units · ${short(t.stockValue)} at MRP`} tone={t.cover !== null && t.cover > OVERSTOCK_DAYS ? "warn" : "default"} />
        <Link href={qs(base, { show: "out" })} className="block">
          <Tile label="Stock-outs ›" value={t.stockOuts} note={`${t.lowFast} fast mover(s) low · ${t.overstock} overstock`} tone={t.stockOuts ? "bad" : "default"} />
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["low", "out", "reorder", "over", "fast"] as const).map((k) => (
          <Link key={k} href={qs(base, { show: show === k ? undefined : k, cat: sp.cat })} className={`rounded-full px-3 py-1.5 font-semibold ring-1 ${show === k ? "bg-[#161616] text-white ring-[#161616]" : "bg-white ring-black/10 hover:bg-black/5"}`}>
            {SHOW[k].title.split(" — ")[0].replace(" (sold in the last 60 days)", "")}
          </Link>
        ))}
        <form action="/staff/performance/stock" className="ml-auto flex gap-2">
          <input type="hidden" name="store" value={store} />
          {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
          {show && <input type="hidden" name="show" value={show} />}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search product or SKU" className="w-56 rounded-full border border-black/10 bg-white px-4 py-1.5 text-sm" />
        </form>
      </div>

      {list ? (
        <section className="rounded-3xl bg-white p-4 soft-card ring-1 ring-black/5 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">
              {[cat?.name, show ? SHOW[show].title : null, q ? `“${sp.q}”` : null].filter(Boolean).join(" · ")} ({list.length})
            </h2>
            <Link href={qs(base, {})} className="text-sm font-semibold text-[#5b55c9]">
              ← All categories
            </Link>
          </div>
          <ItemTable items={list.slice(0, 400)} />
          {list.length > 400 && <p className="mt-2 text-xs text-black/45">Showing the first 400 — search to narrow down.</p>}
        </section>
      ) : (
        <section className="rounded-3xl bg-white p-4 soft-card ring-1 ring-black/5 sm:p-5">
          <h2 className="mb-3 text-lg font-bold">Categories</h2>
          <CategoryTable rows={m.categories} total={t} base={base} />
        </section>
      )}

      <p className="text-xs text-black/45">
        MoM: {fmtRange(m.periods.mtd)} against {fmtRange(m.periods.mom)}. LFL: against {fmtRange(m.periods.lfl)} (same store). Sell-through = units sold this month ÷ (units sold + stock on hand).
        Stock cover = stock ÷ average units sold a day (last 28 days, counting only days with sales data). Under {REORDER_DAYS} days = reorder; over {OVERSTOCK_DAYS} days = overstock. Stock-out = 0 in the store and sold in the
        last 60 days. Fast movers = the top fifth of items by units sold in the last 28 days (at least 4 units). Carry bags are left out. Item amounts are before any whole-bill discount, so totals can be a little higher than on the store dashboard.
      </p>
    </div>
  );
}

function CategoryTable({ rows, total, base }: { rows: MerchCategory[]; total: MerchCategory; base: Search }) {
  const row = (c: MerchCategory, isTotal = false) => (
    <tr key={c.name} className={`border-t border-black/5 ${isTotal ? "bg-black/[0.03] font-bold" : "hover:bg-black/[0.02]"}`}>
      <td className={tdc}>
        {isTotal ? (
          c.name
        ) : (
          <Link href={qs(base, { cat: c.name })} className="font-semibold text-[#5b55c9] hover:underline">
            {c.name}
          </Link>
        )}
      </td>
      <td className={`${tdc} text-right font-semibold`}>{rupees(c.net)}</td>
      <td className={`${tdc} text-right`}>
        <Growth now={c.net} before={c.momNet} />
      </td>
      <td className={`${tdc} text-right`}>
        <Growth now={c.net} before={c.lflNet} />
      </td>
      <td className={`${tdc} text-right`}>{Math.round(c.units)}</td>
      <td className={`${tdc} text-right`}>{pc(c.sellThrough)}</td>
      <td className={`${tdc} text-right`}>{Math.round(c.stock)}</td>
      <td className={`${tdc} text-right ${c.cover !== null && c.cover < REORDER_DAYS ? "font-semibold text-amber-700" : c.cover !== null && c.cover > OVERSTOCK_DAYS ? "font-semibold text-[#5b55c9]" : ""}`}>{days(c.cover)}</td>
      <td className={`${tdc} text-right ${c.stockOuts ? "font-semibold text-[#d6224a]" : ""}`}>{c.stockOuts || "—"}</td>
      <td className={`${tdc} text-right ${c.lowFast ? "font-semibold text-[#d6224a]" : ""}`}>{c.lowFast || "—"}</td>
      <td className={`${tdc} text-right`}>{c.overstock || "—"}</td>
    </tr>
  );
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="min-w-[960px] w-full text-sm">
        <thead>
          <tr>
            <th className={thc}>Category</th>
            <th className={`${thc} text-right`}>Net MTD</th>
            <th className={`${thc} text-right`}>MoM</th>
            <th className={`${thc} text-right`}>LFL</th>
            <th className={`${thc} text-right`}>Units</th>
            <th className={`${thc} text-right`}>Sell-through</th>
            <th className={`${thc} text-right`}>Stock</th>
            <th className={`${thc} text-right`}>Cover days</th>
            <th className={`${thc} text-right`}>Stock-outs</th>
            <th className={`${thc} text-right`}>Fast low</th>
            <th className={`${thc} text-right`}>Overstock</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => row(c))}
          {row(total, true)}
        </tbody>
      </table>
    </div>
  );
}

function ItemTable({ items }: { items: MerchItem[] }) {
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="min-w-[1050px] w-full text-sm">
        <thead>
          <tr>
            <th className={thc}>Product</th>
            <th className={`${thc} text-right`}>Net MTD</th>
            <th className={`${thc} text-right`}>Units</th>
            <th className={`${thc} text-right`}>MoM</th>
            <th className={`${thc} text-right`}>LFL</th>
            <th className={`${thc} text-right`}>Sell-through</th>
            <th className={`${thc} text-right`}>Stock</th>
            <th className={`${thc} text-right`}>Sold 28 days</th>
            <th className={`${thc} text-right`}>Cover days</th>
            <th className={thc}>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-t border-black/5 align-top hover:bg-black/[0.02]">
              <td className="max-w-[340px] px-3 py-2">
                <span className="font-semibold">{i.name}</span>
                {i.fast && <span className="ml-1.5 rounded-full bg-[#0fa8bf]/15 px-1.5 text-[10px] font-bold text-[#0b7f91]">FAST</span>}
                <span className="block text-xs text-black/45">
                  {i.sku ?? "—"} · {i.category}
                </span>
              </td>
              <td className={`${tdc} text-right font-semibold`}>{rupees(i.net)}</td>
              <td className={`${tdc} text-right`}>{Math.round(i.units)}</td>
              <td className={`${tdc} text-right`}>
                <Growth now={i.net} before={i.momNet} />
              </td>
              <td className={`${tdc} text-right`}>
                <Growth now={i.net} before={i.lflNet} />
              </td>
              <td className={`${tdc} text-right`}>{pc(i.sellThrough)}</td>
              <td className={`${tdc} text-right ${i.stock !== null && i.stock <= 0 ? "font-bold text-[#d6224a]" : ""}`}>{i.stock === null ? "—" : Math.round(i.stock)}</td>
              <td className={`${tdc} text-right`}>{Math.round(i.units28)}</td>
              <td className={`${tdc} text-right`}>{days(i.cover)}</td>
              <td className="px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS[i.status].cls}`}>{STATUS[i.status].text}</span>
                {i.outSince && <span className="block text-[11px] text-black/45">since {formatDate(i.outSince)}</span>}
              </td>
            </tr>
          ))}
          {!items.length && (
            <tr>
              <td colSpan={10} className="px-3 py-6 text-center text-sm text-black/45">
                Nothing here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
