import { after, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";
import { readStockFromZoho, isStockReading, loadStockState, saveStockState, stockAlertsFor } from "@/lib/stock";
import { loadBackfill } from "@/lib/sales-backfill";
import { zohoCallsToday } from "@/lib/zoho";
import { logAudit } from "@/lib/audit";

/** Store-days in the rows that already have uploaded lines from another upload, and those that have bills copied from Zoho. */
async function dayCheck(pairs: { store: string; day: string }[], uploadId: string | null) {
  const byStore = new Map<string, string[]>();
  for (const p of pairs) byStore.set(p.store, [...new Set([...(byStore.get(p.store) ?? []), p.day])]);
  const uploaded: { store: string; day: string }[] = [];
  const zoho: { store: string; day: string }[] = [];
  for (const [store, days] of byStore) {
    days.sort();
    const [h, z] = await Promise.all([
      supabaseAdmin.from("sales_history_lines").select("day, upload_id").eq("store", store).gte("day", days[0]).lte("day", days[days.length - 1]).limit(20000),
      supabaseAdmin.from("sales_invoices").select("invoice_date").eq("store", store).gte("invoice_date", days[0]).lte("invoice_date", days[days.length - 1]).limit(50000),
    ]);
    const want = new Set(days);
    const hd = new Set((h.data ?? []).filter((r) => want.has(String(r.day)) && (!uploadId || r.upload_id !== uploadId)).map((r) => String(r.day)));
    const zd = new Set((z.data ?? []).map((r) => String(r.invoice_date)).filter((d) => want.has(d)));
    for (const d of [...hd].sort()) uploaded.push({ store, day: d });
    for (const d of [...zd].sort()) zoho.push({ store, day: d });
  }
  return { uploaded, zoho };
}

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

    case "history_check": {
      // Before an upload: which store-days were uploaded before, and which already have bills from Zoho.
      const pairs = (Array.isArray(body.pairs) ? body.pairs : []).slice(0, 5000) as Body[];
      const clean = pairs.map((p) => ({ store: storeName(p.store), day: String(p.day ?? "") })).filter((p) => p.store && isDay(p.day));
      return NextResponse.json(await dayCheck(clean, null));
    }

    case "history_clear": {
      // Only removes earlier UPLOADED lines; bills copied from Zoho are never touched.
      const store = storeName(body.store);
      if (!store || !isDay(body.from) || !isDay(body.to)) return bad("Store and dates are needed.");
      // Only the days in the file (when given), not every day in between.
      const days = Array.isArray(body.days) ? (body.days as unknown[]).filter(isDay).slice(0, 1000) : null;
      let countQ = supabaseAdmin.from("sales_history_lines").select("id", { count: "exact", head: true }).eq("store", store).gte("day", body.from).lte("day", body.to);
      let delQ = supabaseAdmin.from("sales_history_lines").delete().eq("store", store).gte("day", body.from).lte("day", body.to);
      if (days?.length) {
        countQ = countQ.in("day", days);
        delQ = delQ.in("day", days);
      }
      const { count } = await countQ;
      const { error } = await delQ;
      if (error) return bad("Could not clear earlier uploads.", 500);
      await logAudit(auth.staff, "sales_upload", "replace_earlier_upload", { store, from: body.from, to: body.to, lines: count ?? 0 }, null);
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
      // No duplicates: store-days uploaded before (by another upload) are refused unless "Replace" cleared them first.
      const uploadId = text(body.uploadId, 40);
      const seen = await dayCheck(clean.map((r) => ({ store: r.store, day: r.day as string })), uploadId);
      if (seen.uploaded.length)
        return bad(
          `Already uploaded before for ${seen.uploaded.length} store-day(s) (${seen.uploaded
            .slice(0, 5)
            .map((x) => `${x.store} ${x.day}`)
            .join(", ")}${seen.uploaded.length > 5 ? " …" : ""}). Tick “Replace earlier uploads” to upload them again.`,
          409
        );
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
      const days = [...new Set(save.map((r) => r.day as string))].sort();
      await logAudit(auth.staff, "sales_upload", "upload_sales", null, { uploadId, lines: save.length, stores: [...new Set(save.map((r) => r.store))], from: days[0], to: days[days.length - 1], zohoDaysNotCounted: seen.zoho.length });
      return NextResponse.json({ ok: true, saved: save.length, zohoDays: seen.zoho.length });
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
      // Keep the date an item first went out of stock, and the figures being replaced (kept in the change history).
      const prev = new Map<string, string | null>();
      const before: Record<string, { stock: number; source: string; at: string }> = {};
      for (const store of new Set(keyed.map((r) => r.store))) {
        const ids = keyed.filter((r) => r.store === store).map((r) => r.item_id);
        for (let i = 0; i < ids.length; i += 200) {
          const { data } = await supabaseAdmin.from("stock_levels").select("item_id, out_since, stock, source, updated_at").eq("store", store).in("item_id", ids.slice(i, i + 200));
          for (const d of data ?? []) {
            prev.set(`${store}|${d.item_id}`, d.out_since ?? null);
            before[`${store}|${d.item_id}`] = { stock: Number(d.stock), source: String(d.source ?? ""), at: String(d.updated_at ?? "") };
          }
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
      await logAudit(auth.staff, "stock_upload", "upload_stock", { replaced: before }, { items: save.length, stores: [...new Set(save.map((r) => r.store))] });
      return NextResponse.json({ ok: true, saved: save.length, replaced: Object.keys(before).length });
    }
  }
  return bad("Unknown action.");
}
