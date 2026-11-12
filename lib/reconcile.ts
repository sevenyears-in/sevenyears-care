// Sales check against Zoho POS for one day (server only).
//
// Reads only the bill and credit-note LISTS for the day (200 a request, no bill details) and
// compares them with what is saved here, store by store:
//   Billed (with GST)  = sum of bill totals — the "sales" figure Zoho POS shows
//   Returns (with GST) = sum of credit-note totals
//   Net                = Billed − Returns (what the dashboard shows)
// Differences are listed bill by bill (missing here, not in Zoho any more, or amount changed).

import { supabaseAdmin } from "@/lib/supabase/server";
import { zohoRead } from "@/lib/zoho";
import { SKIP_STATUS, storeKey } from "@/lib/sales-sync";
import { appendSyncLog } from "@/lib/sync-log";

type Obj = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const r2 = (n: number) => Math.round(n * 100) / 100;

async function listDay(path: "invoices" | "creditnotes", date: string) {
  const out: Obj[] = [];
  let reads = 0;
  for (let page = 1; page <= 30; page++) {
    const res = await zohoRead(path, { date_start: date, date_end: date, per_page: "200", page: String(page) });
    reads++;
    out.push(...arr(res[path]));
    if (!(res.page_context as Obj | undefined)?.has_more_page) break;
  }
  return { rows: out.filter((r) => str(r.date) === date && !SKIP_STATUS.has(str(r.status).toLowerCase())), reads };
}

export type StoreCheck = {
  store: string;
  zoho: { bills: number; billed: number; returns: number; returned: number };
  here: { bills: number; billed: number; returns: number; returned: number };
  net: { zoho: number; here: number };
  missingHere: { number: string; amount: number }[];
  notInZoho: { number: string; amount: number }[];
  amountChanged: { number: string; zoho: number; here: number }[];
  ok: boolean;
};

export type DayCheck = { date: string; checkedAt: string; reads: number; stores: StoreCheck[]; ok: boolean; note: string | null };

export async function reconcileDay(date: string): Promise<DayCheck> {
  const started = Date.now();
  const [inv, cn] = await Promise.all([listDay("invoices", date), listDay("creditnotes", date).catch((e) => ({ rows: [] as Obj[], reads: 0, error: String(e) }))]);
  const cnError = (cn as { error?: string }).error ?? null;
  const [{ data: bills }, { data: rets }] = await Promise.all([
    supabaseAdmin.from("sales_invoices").select("invoice_id, invoice_number, store, total, net").eq("invoice_date", date).limit(5000),
    supabaseAdmin.from("sales_returns").select("creditnote_id, creditnote_number, store, total, net").eq("return_date", date).limit(5000),
  ]);
  const stores = new Map<string, StoreCheck>();
  const get = (s: string) => {
    let x = stores.get(s);
    if (!x) {
      x = { store: s, zoho: { bills: 0, billed: 0, returns: 0, returned: 0 }, here: { bills: 0, billed: 0, returns: 0, returned: 0 }, net: { zoho: 0, here: 0 }, missingHere: [], notInZoho: [], amountChanged: [], ok: true };
      stores.set(s, x);
    }
    return x;
  };
  const savedBills = new Map((bills ?? []).map((b) => [String(b.invoice_id), b]));
  const zohoIds = new Set<string>();
  for (const r of inv.rows) {
    const s = storeKey(r.location_name || r.branch_name) ?? "UNKNOWN";
    const x = get(s);
    const total = num(r.total);
    x.zoho.bills++;
    x.zoho.billed += total;
    const id = str(r.invoice_id);
    zohoIds.add(id);
    const here = savedBills.get(id);
    if (!here) x.missingHere.push({ number: str(r.invoice_number), amount: r2(total) });
    else if (Math.abs(num(here.total ?? here.net) - total) > 1) x.amountChanged.push({ number: str(r.invoice_number), zoho: r2(total), here: r2(num(here.total ?? here.net)) });
  }
  for (const b of bills ?? []) {
    const x = get(String(b.store ?? "UNKNOWN"));
    x.here.bills++;
    x.here.billed += num(b.total ?? b.net);
    if (!zohoIds.has(String(b.invoice_id))) x.notInZoho.push({ number: String(b.invoice_number ?? b.invoice_id), amount: r2(num(b.total ?? b.net)) });
  }
  for (const r of cn.rows) {
    const x = get(storeKey(r.location_name || r.branch_name) ?? "UNKNOWN");
    x.zoho.returns++;
    x.zoho.returned += num(r.total);
  }
  for (const r of rets ?? []) {
    const x = get(String(r.store ?? "UNKNOWN"));
    x.here.returns++;
    x.here.returned += num(r.total ?? r.net);
  }
  for (const x of stores.values()) {
    for (const k of ["billed", "returned"] as const) {
      x.zoho[k] = r2(x.zoho[k]);
      x.here[k] = r2(x.here[k]);
    }
    x.net = { zoho: r2(x.zoho.billed - x.zoho.returned), here: r2(x.here.billed - x.here.returned) };
    x.ok = !x.missingHere.length && !x.notInZoho.length && !x.amountChanged.length && x.zoho.returns === x.here.returns && Math.abs(x.net.zoho - x.net.here) <= 2;
  }
  const list = [...stores.values()].sort((a, b) => a.store.localeCompare(b.store));
  const result: DayCheck = {
    date,
    checkedAt: new Date().toISOString(),
    reads: inv.reads + cn.reads,
    stores: list,
    ok: list.every((s) => s.ok) && !cnError,
    note: cnError ? `Returns could not be read from Zoho: ${cnError}` : null,
  };
  await appendSyncLog({
    at: result.checkedAt,
    kind: "check",
    status: result.ok ? "ok" : "partial",
    ms: Date.now() - started,
    days: [{ date, bills: list.reduce((s, x) => s + x.zoho.bills, 0), billsSaved: 0, returns: list.reduce((s, x) => s + x.zoho.returns, 0), returnsSaved: 0, pending: list.reduce((s, x) => s + x.missingHere.length + x.notInZoho.length + x.amountChanged.length, 0) }],
    error: result.ok ? null : "Differences found — see the sales check.",
    retried: false,
  });
  return result;
}

/** Saved figures per store and day (no Zoho requests): bills, billed, returns, net, last copied. */
export async function savedDaily(from: string, to: string) {
  const days = new Map<string, { date: string; store: string; bills: number; billed: number; returns: number; returned: number; lastSynced: string | null }>();
  const key = (d: string, s: string) => `${d}|${s}`;
  const get = (d: string, s: string) => {
    let x = days.get(key(d, s));
    if (!x) {
      x = { date: d, store: s, bills: 0, billed: 0, returns: 0, returned: 0, lastSynced: null };
      days.set(key(d, s), x);
    }
    return x;
  };
  for (let start = 0; start < 100_000; start += 1000) {
    const { data } = await supabaseAdmin.from("sales_invoices").select("invoice_date, store, total, net, synced_at").gte("invoice_date", from).lte("invoice_date", to).order("invoice_id").range(start, start + 999);
    for (const b of data ?? []) {
      const x = get(String(b.invoice_date), String(b.store ?? "UNKNOWN"));
      x.bills++;
      x.billed += num(b.total ?? b.net);
      if (b.synced_at && (!x.lastSynced || b.synced_at > x.lastSynced)) x.lastSynced = b.synced_at;
    }
    if (!data || data.length < 1000) break;
  }
  for (let start = 0; start < 100_000; start += 1000) {
    const { data } = await supabaseAdmin.from("sales_returns").select("return_date, store, total, net").gte("return_date", from).lte("return_date", to).order("creditnote_id").range(start, start + 999);
    for (const r of data ?? []) {
      const x = get(String(r.return_date), String(r.store ?? "UNKNOWN"));
      x.returns++;
      x.returned += num(r.total ?? r.net);
    }
    if (!data || data.length < 1000) break;
  }
  return [...days.values()].map((x) => ({ ...x, billed: r2(x.billed), returned: r2(x.returned), net: r2(x.billed - x.returned) })).sort((a, b) => (a.date === b.date ? a.store.localeCompare(b.store) : b.date.localeCompare(a.date)));
}
