import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zohoConfigured, zohoRead } from "@/lib/zoho";
import { syncSalesDay } from "@/lib/sales-sync";
import { loadPerformanceSettings, savePerformanceSettings } from "@/lib/performance-settings";
import { isGroup, isMonth } from "@/lib/performance-rules";
import { todayISO } from "@/lib/helpers";

// Sales targets & incentives settings (Super Admin and Admin).

type Body = Record<string, unknown>;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const money = (v: unknown) => {
  const x = Math.round(Number(String(v ?? "").replace(/[₹,\s]/g, "")));
  return Number.isFinite(x) && x >= 0 && x < 1e10 ? x : null;
};
const isDate = (v: unknown): v is string => typeof v === "string" && /^20\d\d-\d\d-\d\d$/.test(v);

// GET ?q=... → Zoho items matching a name or SKU (to add to Slow-moving / B2G1 lists)
export async function GET(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ items: [] });
  if (!(await zohoConfigured())) return bad("Zoho POS is not connected.");
  try {
    const res = await zohoRead("items", { search_text: q, per_page: "25", filter_by: "Status.Active" });
    const items = (Array.isArray(res.items) ? (res.items as Body[]) : []).map((i) => ({
      item_id: String(i.item_id ?? ""),
      name: String(i.name ?? ""),
      sku: i.sku ? String(i.sku) : null,
      rate: Number(i.rate) || 0,
      category: String(i.category_name ?? ""),
    }));
    return NextResponse.json({ items });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Zoho search failed.", 502);
  }
}

export async function POST(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Body;
  const by = auth.staff.userId;

  switch (body.action) {
    case "settings": {
      const pct = Number(body.highDiscountPct);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return bad("High discount must be between 0 and 100%.");
      const duties = Math.round(Number(body.dutiesRequired));
      if (!Number.isFinite(duties) || duties < 1 || duties > 31) return bad("Duties must be between 1 and 31.");
      const storeTargets: Record<string, number> = {};
      for (const [store, value] of Object.entries((body.storeTargets ?? {}) as Body)) {
        const v = money(value);
        if (v === null) return bad(`Check the target of ${store}.`);
        if (store.trim()) storeTargets[store.trim().toUpperCase()] = v;
      }
      const excludedStores = (Array.isArray(body.excludedStores) ? body.excludedStores : [])
        .map((s) => String(s).trim().toUpperCase())
        .filter(Boolean);
      await savePerformanceSettings({ highDiscountPct: Math.round(pct * 100) / 100, dutiesRequired: duties, storeTargets, excludedStores });
      return NextResponse.json({ ok: true });
    }

    case "link": {
      const name = String(body.salesperson ?? "").replace(/\s+/g, " ").trim().toUpperCase();
      if (!name) return bad("Salesperson missing.");
      const userId = String(body.userId ?? "").trim();
      const current = await loadPerformanceSettings();
      const links = { ...current.salespersonLinks };
      if (userId) links[name] = userId;
      else delete links[name];
      await savePerformanceSettings({ salespersonLinks: links });
      // Bills already copied get the new owner straight away.
      const ids = userId || null;
      await supabaseAdmin.from("sales_invoices").update({ staff_user_id: ids }).ilike("salesperson", name);
      const { data: bills } = await supabaseAdmin.from("sales_invoices").select("invoice_id").ilike("salesperson", name).limit(20000);
      const list = (bills ?? []).map((b) => b.invoice_id as string);
      for (let i = 0; i < list.length; i += 200) {
        await supabaseAdmin.from("sales_invoice_lines").update({ staff_user_id: ids }).in("invoice_id", list.slice(i, i + 200));
        const { data: rets } = await supabaseAdmin.from("sales_returns").update({ staff_user_id: ids }).in("invoice_id", list.slice(i, i + 200)).select("creditnote_id");
        const cn = (rets ?? []).map((r) => r.creditnote_id as string);
        if (cn.length) await supabaseAdmin.from("sales_return_lines").update({ staff_user_id: ids }).in("creditnote_id", cn);
      }
      return NextResponse.json({ ok: true });
    }

    case "targets": {
      if (!isMonth(body.month)) return bad("Choose a month.");
      const rows = Array.isArray(body.rows) ? (body.rows as Body[]) : [];
      const save: { user_id: string; month: string; sales_target: number; abv_target: number | null; updated_at: string; updated_by: string }[] = [];
      const remove: string[] = [];
      for (const r of rows) {
        const userId = String(r.userId ?? "").trim();
        if (!userId) continue;
        const sales = r.sales === "" || r.sales === null || r.sales === undefined ? null : money(r.sales);
        const abv = r.abv === "" || r.abv === null || r.abv === undefined ? null : money(r.abv);
        if (sales === null && abv === null) {
          remove.push(userId);
          continue;
        }
        save.push({ user_id: userId, month: body.month, sales_target: sales ?? 0, abv_target: abv, updated_at: new Date().toISOString(), updated_by: by });
      }
      if (save.length) {
        const { error } = await supabaseAdmin.from("staff_sales_targets").upsert(save);
        if (error) return bad(error.message, 500);
      }
      if (remove.length) await supabaseAdmin.from("staff_sales_targets").delete().eq("month", body.month).in("user_id", remove);
      return NextResponse.json({ ok: true, saved: save.length });
    }

    case "copy_targets": {
      if (!isMonth(body.from) || !isMonth(body.to)) return bad("Choose a month.");
      const [{ data: prev }, { data: now }] = await Promise.all([
        supabaseAdmin.from("staff_sales_targets").select("user_id, sales_target, abv_target").eq("month", body.from),
        supabaseAdmin.from("staff_sales_targets").select("user_id").eq("month", body.to),
      ]);
      const have = new Set((now ?? []).map((r) => r.user_id as string));
      const rows = (prev ?? [])
        .filter((r) => !have.has(r.user_id as string))
        .map((r) => ({ user_id: r.user_id, month: body.to as string, sales_target: r.sales_target, abv_target: r.abv_target, updated_at: new Date().toISOString(), updated_by: by }));
      if (rows.length) {
        const { error } = await supabaseAdmin.from("staff_sales_targets").insert(rows);
        if (error) return bad(error.message, 500);
      }
      return NextResponse.json({ ok: true, copied: rows.length });
    }

    case "store_target": {
      if (!isMonth(body.month)) return bad("Choose a month.");
      const store = String(body.store ?? "").trim().toUpperCase();
      if (!store) return bad("Store missing.");
      const v = body.target === "" || body.target === null ? null : money(body.target);
      if (v === null) await supabaseAdmin.from("store_sales_targets").delete().eq("store", store).eq("month", body.month);
      else await supabaseAdmin.from("store_sales_targets").upsert({ store, month: body.month, target: v, updated_at: new Date().toISOString() });
      return NextResponse.json({ ok: true });
    }

    case "group": {
      const staffId = String(body.staffId ?? "");
      const group = body.group === "" || body.group === null ? null : body.group;
      if (!staffId) return bad("Staff missing.");
      if (group !== null && !isGroup(group)) return bad("Unknown group.");
      const { error } = await supabaseAdmin.from("staff_users").update({ incentive_group: group }).eq("id", staffId);
      if (error) return bad(error.message, 500);
      return NextResponse.json({ ok: true });
    }

    case "promo_add": {
      const kind = body.kind === "b2g1" ? "b2g1" : body.kind === "slow_moving" ? "slow_moving" : null;
      if (!kind) return bad("Choose Slow-moving or Buy 2 Get 1.");
      const items = (Array.isArray(body.items) ? (body.items as Body[]) : []).slice(0, 200);
      const from = isDate(body.from) ? body.from : null;
      const to = isDate(body.to) ? body.to : null;
      if (from && to && to < from) return bad("The end date is before the start date.");
      const rows = items
        .map((i) => ({
          kind,
          item_id: i.item_id ? String(i.item_id) : null,
          sku: i.sku ? String(i.sku).trim() : null,
          name: String(i.name ?? i.sku ?? "").trim().slice(0, 200),
          from_date: from,
          to_date: to,
          created_by: by,
        }))
        .filter((r) => r.name && (r.item_id || r.sku));
      if (!rows.length) return bad("Pick at least one product.");
      let added = 0;
      for (const row of rows) {
        // Already on the list → update its dates instead.
        let q = supabaseAdmin.from("promo_products").select("id").eq("kind", kind);
        q = row.item_id ? q.eq("item_id", row.item_id) : q.is("item_id", null).eq("sku", row.sku as string);
        const { data: existing } = await q.maybeSingle();
        if (existing) await supabaseAdmin.from("promo_products").update({ from_date: from, to_date: to }).eq("id", existing.id);
        else {
          const { error } = await supabaseAdmin.from("promo_products").insert(row);
          if (error) return bad(error.message, 500);
          added++;
        }
      }
      return NextResponse.json({ ok: true, added });
    }

    case "promo_remove": {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return bad("Product missing.");
      await supabaseAdmin.from("promo_products").delete().eq("id", id);
      return NextResponse.json({ ok: true });
    }

    case "sync": {
      const date = isDate(body.date) ? body.date : todayISO();
      if (date > todayISO()) return NextResponse.json({ date, bills: 0, billsSaved: 0, returns: 0, returnsSaved: 0, pending: 0 });
      try {
        const result = await syncSalesDay(date, 40);
        if (date === todayISO() || result.pending === 0) {
          await savePerformanceSettings({ lastSyncAt: new Date().toISOString(), returnsError: result.returnsError ?? null });
        }
        return NextResponse.json(result);
      } catch (error) {
        return bad(error instanceof Error ? error.message : "Sync failed.", 502);
      }
    }
  }
  return bad("Unknown action.");
}
