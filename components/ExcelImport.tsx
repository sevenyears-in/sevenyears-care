"use client";

// Settings → Upload from Excel: sales history (for LFL / MoM when the Zoho copy has not reached
// those days) and stock on hand. The file is read in the browser; only the needed columns are sent.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { readSheet, toISODate, toNumber } from "@/lib/sheet-read";

type Kind = "sales" | "stock";
type Field = { key: string; label: string; required?: boolean; guess: RegExp };

const FIELDS: Record<Kind, Field[]> = {
  sales: [
    { key: "date", label: "Date", required: true, guess: /invoice\s*date|bill\s*date|^date$|transaction\s*date/i },
    { key: "store", label: "Store / location", guess: /location|branch|warehouse|store|outlet/i },
    { key: "item_id", label: "Item ID", guess: /^item\s*id$|product\s*id/i },
    { key: "sku", label: "SKU", guess: /^sku$|item\s*code|product\s*code|barcode/i },
    { key: "name", label: "Item name", required: true, guess: /item\s*name|product\s*name|^item$|^name$|^product$|description/i },
    { key: "category", label: "Category", guess: /category/i },
    { key: "qty", label: "Quantity", required: true, guess: /quantity|qty|units/i },
    { key: "amount", label: "Amount", required: true, guess: /item\s*total|line\s*total|^total$|amount|sales|net/i },
    { key: "tax", label: "Tax % (if amounts are without GST)", guess: /tax\s*%|tax\s*percent|gst\s*%|tax\s*rate/i },
  ],
  stock: [
    { key: "store", label: "Store / location", guess: /location|branch|warehouse|store|outlet/i },
    { key: "item_id", label: "Item ID", guess: /^item\s*id$|product\s*id/i },
    { key: "sku", label: "SKU", guess: /^sku$|item\s*code|product\s*code|barcode/i },
    { key: "name", label: "Item name", required: true, guess: /item\s*name|product\s*name|^item$|^name$|^product$/i },
    { key: "category", label: "Category", guess: /category/i },
    { key: "stock", label: "Stock on hand", required: true, guess: /stock\s*on\s*hand|closing\s*stock|available\s*stock|^stock$|quantity\s*available|on\s*hand|qty/i },
  ],
};

async function post(body: unknown) {
  const res = await fetch("/api/staff/admin/stock-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Upload failed.");
  return data;
}

const input = "w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm";

export function ExcelImport({ stores }: { stores: string[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("sales");
  const [file, setFile] = useState<{ name: string; header: string[]; rows: string[][] } | null>(null);
  const [map, setMap] = useState<Record<string, number>>({});
  const [store, setStore] = useState("");
  const [withGst, setWithGst] = useState(true);
  const [gstPct, setGstPct] = useState("");
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function choose(f: File | undefined, k = kind) {
    setError("");
    setDone("");
    setFile(null);
    if (!f) return;
    try {
      const sheet = await readSheet(f);
      const guess: Record<string, number> = {};
      for (const field of FIELDS[k]) {
        const i = sheet.header.findIndex((h) => field.guess.test(h) && !Object.values(guess).includes(sheet.header.indexOf(h)));
        if (i >= 0) guess[field.key] = i;
      }
      setMap(guess);
      setFile({ name: f.name, ...sheet });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    }
  }

  const cell = (r: string[], key: string) => (map[key] !== undefined && map[key] >= 0 ? (r[map[key]] ?? "").trim() : "");

  const parsed = useMemo(() => {
    if (!file) return null;
    const problems: string[] = [];
    const missing = FIELDS[kind].filter((f) => f.required && (map[f.key] === undefined || map[f.key] < 0)).map((f) => f.label);
    if (missing.length) return { rows: [], problems: [`Choose the column for: ${missing.join(", ")}.`] };
    if ((map.store === undefined || map.store < 0) && !store) problems.push("Choose the store (the file has no store column).");
    const rows: Record<string, string | number | null>[] = [];
    let skipped = 0;
    for (const r of file.rows) {
      const name = cell(r, "name");
      const storeName = (cell(r, "store") || store).replace(/\s+/g, " ").toUpperCase();
      if (!name || !storeName) {
        skipped++;
        continue;
      }
      if (kind === "sales") {
        const day = toISODate(cell(r, "date"));
        const qty = toNumber(cell(r, "qty"));
        let amount = toNumber(cell(r, "amount"));
        if (!day || !Number.isFinite(qty) || !Number.isFinite(amount)) {
          skipped++;
          continue;
        }
        if (!withGst) {
          const t = map.tax !== undefined ? toNumber(cell(r, "tax")) : toNumber(gstPct);
          amount = amount * (1 + (Number.isFinite(t) ? t : 0) / 100);
        }
        rows.push({ day, store: storeName, item_id: cell(r, "item_id") || null, sku: cell(r, "sku") || null, name, category: cell(r, "category") || null, quantity: qty, net: Math.round(amount * 100) / 100 });
      } else {
        const stock = toNumber(cell(r, "stock"));
        if (!Number.isFinite(stock)) {
          skipped++;
          continue;
        }
        rows.push({ store: storeName, item_id: cell(r, "item_id") || null, sku: cell(r, "sku") || null, name, category: cell(r, "category") || null, stock });
      }
    }
    if (skipped) problems.push(`${skipped} row(s) without a usable ${kind === "sales" ? "date, item, quantity or amount" : "item or stock"} will be left out.`);
    return { rows, problems };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, map, kind, store, withGst, gstPct]);

  const summary = useMemo(() => {
    if (!parsed?.rows.length) return null;
    const stores = [...new Set(parsed.rows.map((r) => String(r.store)))];
    if (kind === "sales") {
      const days = parsed.rows.map((r) => String(r.day)).sort();
      return `${parsed.rows.length} line(s) · ${stores.join(", ")} · ${days[0]} to ${days[days.length - 1]} · ${Math.round(parsed.rows.reduce((s, r) => s + Number(r.quantity), 0))} units · ₹${Math.round(parsed.rows.reduce((s, r) => s + Number(r.net), 0)).toLocaleString("en-IN")}`;
    }
    return `${parsed.rows.length} item(s) · ${stores.join(", ")} · ${Math.round(parsed.rows.reduce((s, r) => s + Math.max(0, Number(r.stock)), 0))} units in stock`;
  }, [parsed, kind]);

  async function upload() {
    if (!parsed?.rows.length) return;
    setBusy(true);
    setError("");
    setDone("");
    try {
      const uploadId = `${Date.now()}`;
      if (kind === "sales" && replace) {
        const byStore = new Map<string, string[]>();
        for (const r of parsed.rows) byStore.set(String(r.store), [...(byStore.get(String(r.store)) ?? []), String(r.day)]);
        for (const [s, ds] of byStore) {
          ds.sort();
          await post({ action: "history_clear", store: s, from: ds[0], to: ds[ds.length - 1] });
        }
      }
      let saved = 0;
      for (let i = 0; i < parsed.rows.length; i += 1000) {
        const r = await post({ action: kind === "sales" ? "history" : "stock", uploadId, rows: parsed.rows.slice(i, i + 1000) });
        saved += r.saved ?? 0;
        setDone(`Uploading… ${Math.min(parsed.rows.length, i + 1000)} of ${parsed.rows.length}`);
      }
      setDone(`✓ ${saved} ${kind === "sales" ? "sales line(s)" : "stock item(s)"} saved.`);
      setFile(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2">
        {(["sales", "stock"] as const).map((k) => (
          <button
            key={k}
            className={`rounded-full px-4 py-1.5 font-semibold ring-1 ${kind === k ? "bg-[#161616] text-white ring-[#161616]" : "ring-black/10 hover:bg-black/5"}`}
            onClick={() => {
              setKind(k);
              setFile(null);
              setDone("");
              setError("");
            }}
          >
            {k === "sales" ? "Sales (item-wise, by date)" : "Stock on hand"}
          </button>
        ))}
      </div>
      <p className="text-black/60">
        {kind === "sales"
          ? "For LFL / MoM when the night copy from Zoho has not reached those days yet. Export an item-wise sales report or the invoice list with line items (one row per item, with date, item, quantity and amount) from Zoho POS, as Excel (.xlsx) or CSV. Uploaded lines are used only for days that have no bills copied from Zoho."
          : "Export the stock report (item, SKU, stock on hand, location) from Zoho POS as Excel or CSV. It replaces the stock of those items until the next nightly stock read."}
      </p>
      <input type="file" accept=".xlsx,.csv" onChange={(e) => choose(e.target.files?.[0])} className="block text-sm" />
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-red-800">{error}</p>}
      {file && (
        <div className="space-y-3 rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
          <p className="font-semibold">
            {file.name} · {file.rows.length} row(s). Check which column is which:
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {FIELDS[kind].map((f) => (
              <label key={f.key} className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-black/45">
                  {f.label}
                  {f.required ? " *" : ""}
                </span>
                <select className={`${input} mt-1`} value={map[f.key] ?? -1} onChange={(e) => setMap({ ...map, [f.key]: Number(e.target.value) })}>
                  <option value={-1}>— not in the file —</option>
                  {file.header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {(map.store === undefined || map.store < 0) && (
            <label className="block max-w-xs">
              <span className="text-xs font-bold uppercase tracking-wide text-black/45">Store for every row *</span>
              <select className={`${input} mt-1`} value={store} onChange={(e) => setStore(e.target.value)}>
                <option value="">Choose…</option>
                {stores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "sales" && (
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={withGst} onChange={(e) => setWithGst(e.target.checked)} className="h-4 w-4" /> Amounts include GST
              </label>
              {!withGst && (map.tax === undefined || map.tax < 0) && (
                <label className="flex items-center gap-2">
                  Add GST % <input className={`${input} w-20`} value={gstPct} onChange={(e) => setGstPct(e.target.value.replace(/[^\d.]/g, ""))} />
                </label>
              )}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="h-4 w-4" /> Replace earlier uploads for the same store and dates
              </label>
            </div>
          )}
          {parsed?.problems.map((p) => (
            <p key={p} className="text-amber-800">
              ⚠ {p}
            </p>
          ))}
          {summary && <p className="font-semibold text-green-800">Ready: {summary}</p>}
          <button className="rounded-full bg-[#8883d7] px-5 py-2 font-semibold text-white disabled:opacity-50" disabled={busy || !parsed?.rows.length} onClick={upload}>
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      )}
      {done && <p className="font-semibold text-green-700">{done}</p>}
    </div>
  );
}
