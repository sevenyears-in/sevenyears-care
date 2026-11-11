import { after, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";
import { readStockFromZoho, isStockReading, loadStockState, saveStockState, stockAlertsFor } from "@/lib/stock";
import { loadBackfill } from "@/lib/sales-backfill";
import { zohoCallsToday } from "@/lib/zoho";

// Settings → Upload from Excel (admins), and "Read stock now" (Super Admin).
//   { action: "history_clear", store, from, to }  — remove earlier uploaded sales lines for those days
//   { action: "history", uploadId, rows: [{ day, store, item_id, sku, name, category, quantity, net }] }
//   { action: "stock", rows: [{ store, item_id, sku, name, category, stock }] }
//   { action: "read_stock" }  — read stock from Zoho now (in the background)

type Body = Record<string, unknown>;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const text = (v: unknown, max = 200) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const isDay = (v: unknown): v is string => typeof v === "string" && /^20\d\d-\d\d-\d\d$/.test(v) && !Number.isNaN(Date.parse(v));
const storeName = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 80);

/** SKU → Zoho item ID and category, from stock already read and bills already copied. */
async function itemsBySku(skus: string[]) {
  const out = new Map<string, { id: string; category: string | null }>();
  const list = [...new Set(skus.filter(Boolean))];
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const [a, b] = await Promise.all([
      supabaseAdmin.from("stock_levels").select("sku, item_id, category").in("sku", chunk),
      supabaseAdmin.from("sales_invoice_lines").select("sku, item_id, category").in("sku", chunk).not("item_id", "is", null).limit(2000),
    ]);
    for (const r of [...(a.data ?? []), ...(b.data ?? [])]) if (r.sku && r.item_id && !out.has(r.sku)) out.set(r.sku, { id: r.item_id, category: r.category ?? null });
  }
  return out;
}

export async function POST(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Body;

  switch (body.action) {
    case "read_stock": {
      if (auth.staff.role !== "super_admin") return bad("Only the Super Admin can do this.", 403);
      if (isStockReading()) return bad("Stock is being read already.");
      const settings = await loadBackfill();
      const room = settings.dailyQuota - (await zohoCallsToday()) - 500;
      if (room < 100) return bad("Not enough Zoho requests left today. Stock will be read tonight at 11:30 pm.");
      after(() => readStockFromZoho(Math.min(1000, room)).then((r) => console.log("Stock read:", r)).catch(() => undefined));
      return NextResponse.json({ ok: true });
    }

    case "history_clear": {
      const store = storeName(body.store);
      if (!store || !isDay(body.from) || !isDay(body.to)) return bad("Store and dates are needed.");
      const { error } = await supabaseAdmin.from("sales_history_lines").delete().eq("store", store).gte("day", body.from).lte("day", body.to);
      if (error) return bad("Could not clear earlier uploads.", 500);
      return NextResponse.json({ ok: true });
    }

    case "history": {
      const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 2000) as Body[];
      const today = todayISO();
      const clean = rows
        .map((r) => ({
          day: isDay(r.day) ? r.day : null,
          store: storeName(r.store),
          item_id: text(r.item_id, 60),
          sku: text(r.sku, 80),
          name: text(r.name) ?? "",
          category: text(r.category, 80),
          quantity: Number(r.quantity),
          net: Number(r.net),
        }))
        .filter((r) => r.day && r.day <= today && r.store && r.name && Number.isFinite(r.quantity) && Number.isFinite(r.net));
      if (!clean.length) return bad("No usable rows (date, store, item, quantity and amount are needed).");
      const bySku = await itemsBySku(clean.filter((r) => !r.item_id && r.sku).map((r) => r.sku as string));
      const save = clean.map((r) => {
        const m = r.sku ? bySku.get(r.sku) : undefined;
        return { ...r, item_id: r.item_id ?? m?.id ?? null, category: r.category ?? m?.category ?? null, upload_id: text(body.uploadId, 40) };
      });
      const { error } = await supabaseAdmin.from("sales_history_lines").insert(save);
      if (error) {
        console.error("History upload error:", error);
        return bad("Could not save the rows.", 500);
      }
      return NextResponse.json({ ok: true, saved: save.length });
    }

    case "stock": {
      const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 2000) as Body[];
      const clean = rows
        .map((r) => ({ store: storeName(r.store), item_id: text(r.item_id, 60), sku: text(r.sku, 80), name: text(r.name) ?? "", category: text(r.category, 80), stock: Number(r.stock) }))
        .filter((r) => r.store && r.name && Number.isFinite(r.stock));
      if (!clean.length) return bad("No usable rows (store, item and stock are needed).");
      const bySku = await itemsBySku(clean.filter((r) => !r.item_id && r.sku).map((r) => r.sku as string));
      const keyed = clean
        .map((r) => {
          const m = r.sku ? bySku.get(r.sku) : undefined;
          const id = r.item_id ?? m?.id ?? (r.sku ? `sku:${r.sku}` : null);
          return id ? { ...r, item_id: id, category: r.category ?? m?.category ?? null } : null;
        })
        .filter((r): r is NonNullable<typeof r> => Boolean(r));
      // Keep the date an item first went out of stock.
      const prev = new Map<string, string | null>();
      for (const store of new Set(keyed.map((r) => r.store))) {
        const ids = keyed.filter((r) => r.store === store).map((r) => r.item_id);
        for (let i = 0; i < ids.length; i += 200) {
          const { data } = await supabaseAdmin.from("stock_levels").select("item_id, out_since").eq("store", store).in("item_id", ids.slice(i, i + 200));
          for (const d of data ?? []) prev.set(`${store}|${d.item_id}`, d.out_since ?? null);
        }
      }
      const today = todayISO();
      const now = new Date().toISOString();
      const unique = new Map(keyed.map((r) => [`${r.store}|${r.item_id}`, r]));
      const save = [...unique.values()].map((r) => ({
        store: r.store,
        item_id: r.item_id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        stock: r.stock,
        out_since: r.stock <= 0 ? prev.get(`${r.store}|${r.item_id}`) || today : null,
        source: "upload",
        updated_at: now,
      }));
      for (let i = 0; i < save.length; i += 500) {
        const { error } = await supabaseAdmin.from("stock_levels").upsert(save.slice(i, i + 500));
        if (error) {
          console.error("Stock upload error:", error);
          return bad("Could not save the stock.", 500);
        }
      }
      // Refresh the low-stock alerts of these stores.
      const state = await loadStockState();
      const alerts = { ...state.alerts };
      for (const store of new Set(save.map((r) => r.store))) {
        const a = await stockAlertsFor(store).catch(() => null);
        if (a) alerts[store] = { low: a.lowFast, out: a.out.length, at: now };
      }
      await saveStockState({ alerts });
      return NextResponse.json({ ok: true, saved: save.length });
    }
  }
  return bad("Unknown action.");
}
