import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zohoConfigured, zohoRead } from "@/lib/zoho";
import { setSalespersonOwner, staffIdFromSalesperson, syncSalesDay } from "@/lib/sales-sync";
import { loadIncentiveRules, loadPerformanceSettings, saveIncentiveRules, savePerformanceSettings } from "@/lib/performance-settings";
import { GROUP_LABEL, groupList, isBuiltInGroup, isGroup, isMonth, isPtCode, type IncentiveGroup } from "@/lib/performance-rules";
import { ruleProblem, type IncentiveRule, type RuleKind } from "@/lib/incentive-rules";
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
      await setSalespersonOwner(name, userId || staffIdFromSalesperson(name, {}));
      return NextResponse.json({ ok: true });
    }

    case "group_add": {
      const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!name) return bad("Type the group name.");
      const current = await loadPerformanceSettings();
      if (groupList(current).some((g) => g.label.toLowerCase() === name.toLowerCase())) return bad("There is already a group with that name.");
      const key = `g_${Date.now().toString(36)}`;
      await savePerformanceSettings({ customGroups: [...current.customGroups, key], groupLabels: { ...current.groupLabels, [key]: name } });
      return NextResponse.json({ ok: true, key });
    }

    case "group_rename": {
      const key = String(body.key ?? "");
      const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      const current = await loadPerformanceSettings();
      if (!groupList(current).some((g) => g.key === key)) return bad("Group not found.");
      if (!name) return bad("Type the group name.");
      if (groupList(current).some((g) => g.key !== key && g.label.toLowerCase() === name.toLowerCase())) return bad("There is already a group with that name.");
      const labels = { ...current.groupLabels };
      if (isBuiltInGroup(key) && name === GROUP_LABEL[key]) delete labels[key];
      else labels[key] = name;
      await savePerformanceSettings({ groupLabels: labels });
      return NextResponse.json({ ok: true });
    }

    case "group_delete": {
      const key = String(body.key ?? "");
      const current = await loadPerformanceSettings();
      if (!current.customGroups.includes(key)) return bad("Only groups added here can be deleted.");
      const [{ count }, rules] = await Promise.all([
        supabaseAdmin.from("staff_users").select("id", { count: "exact", head: true }).eq("incentive_group", key),
        loadIncentiveRules(),
      ]);
      const pt = Object.values(current.ptPeople).some((p) => p.group === key);
      if ((count ?? 0) > 0 || pt) return bad("Move the people in this group to another group first.");
      if (rules.some((r) => r.groups.includes(key) || (r.kind === "store_pool" && (r.split[key] ?? 0) > 0))) return bad("An incentive is given to this group. Change that incentive first.");
      const labels = { ...current.groupLabels };
      delete labels[key];
      await savePerformanceSettings({ customGroups: current.customGroups.filter((k) => k !== key), groupLabels: labels });
      return NextResponse.json({ ok: true });
    }

    case "incentive_store": {
      const userId = String(body.userId ?? "").trim();
      const store = String(body.store ?? "").trim().toUpperCase();
      if (!userId) return bad("Staff missing.");
      const current = await loadPerformanceSettings();
      const map = { ...current.incentiveStores };
      if (store) map[userId] = store;
      else delete map[userId];
      await savePerformanceSettings({ incentiveStores: map });
      return NextResponse.json({ ok: true });
    }

    case "rule_save": {
      // Add a new incentive, or change one. A change with a date after the start of the current
      // version ends that version the day before and starts a new one (history stays as it was).
      const settingsNow = await loadPerformanceSettings();
      const allowed = groupList(settingsNow).filter((g) => g.key !== "none").map((g) => g.key);
      const rule = cleanRule(body.rule, allowed);
      if (!rule) return bad("Check the incentive details.");
      const problem = ruleProblem(rule);
      if (problem) return bad(problem);
      const rules = await loadIncentiveRules();
      const at = rules.findIndex((r) => r.id === rule.id);
      if (at < 0) {
        if (!rule.from) return bad("Choose the date the new incentive starts.");
        rule.id = `${rule.kind}_${Date.now().toString(36)}`;
        if ((rule.kind === "product_units" || rule.kind === "product_value") && !rule.list) rule.list = rule.id;
        await saveIncentiveRules([...rules, rule]);
        return NextResponse.json({ ok: true, id: rule.id });
      }
      const old = rules[at];
      const from = rule.from;
      if (!from && old.from) return bad("Choose the date the change starts.");
      if (from && (!old.from || from > old.from)) {
        if (old.to && old.to < from) return bad("This incentive had already ended before that date.");
        const dayBefore = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        const ended = { ...old, to: dayBefore } as IncentiveRule;
        const next = { ...rule, id: `${rule.kind}_${Date.now().toString(36)}`, to: old.to } as IncentiveRule;
        if ((next.kind === "product_units" || next.kind === "product_value") && (old.kind === "product_units" || old.kind === "product_value")) next.list = old.list;
        const list = [...rules];
        list.splice(at, 1, ended, next);
        await saveIncentiveRules(list);
        return NextResponse.json({ ok: true, id: next.id });
      }
      // Same start date (or a correction before it started): change in place.
      const list = [...rules];
      list[at] = { ...rule, id: old.id, ...(old.kind === "product_units" || old.kind === "product_value" ? { list: (old as { list: string }).list } : {}) } as IncentiveRule;
      await saveIncentiveRules(list);
      return NextResponse.json({ ok: true, id: old.id });
    }

    case "rule_stop": {
      const id = String(body.id ?? "");
      const to = isDate(body.to) ? body.to : null;
      if (!to) return bad("Choose the last day this incentive is in force.");
      const rules = await loadIncentiveRules();
      const r = rules.find((x) => x.id === id);
      if (!r) return bad("Incentive not found.");
      if (r.from && to < r.from) return bad("That date is before the incentive starts. Delete it instead.");
      await saveIncentiveRules(rules.map((x) => (x.id === id ? ({ ...x, to } as IncentiveRule) : x)));
      return NextResponse.json({ ok: true });
    }

    case "rule_restart": {
      const id = String(body.id ?? "");
      const rules = await loadIncentiveRules();
      if (!rules.some((x) => x.id === id)) return bad("Incentive not found.");
      await saveIncentiveRules(rules.map((x) => (x.id === id ? ({ ...x, to: null } as IncentiveRule) : x)));
      return NextResponse.json({ ok: true });
    }

    case "rule_delete": {
      const id = String(body.id ?? "");
      const rules = await loadIncentiveRules();
      const r = rules.find((x) => x.id === id);
      if (!r) return bad("Incentive not found.");
      if (!r.from || r.from <= todayISO()) return bad("This incentive has already been in force. Stop it from a date instead of deleting it.");
      await saveIncentiveRules(rules.filter((x) => x.id !== id));
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
      if (group !== null && !(isGroup(group) && groupList(await loadPerformanceSettings()).some((g) => g.key === group))) return bad("Unknown group.");
      if (isPtCode(staffId)) {
        const current = await loadPerformanceSettings();
        const people = { ...current.ptPeople };
        people[staffId] = { ...(people[staffId] ?? { name: staffId }), group: (group ?? undefined) as IncentiveGroup | undefined };
        await savePerformanceSettings({ ptPeople: people });
        return NextResponse.json({ ok: true });
      }
      const { error } = await supabaseAdmin.from("staff_users").update({ incentive_group: group }).eq("id", staffId);
      if (error) return bad(error.message, 500);
      return NextResponse.json({ ok: true });
    }

    case "promo_add": {
      const kind = typeof body.kind === "string" && /^[a-z0-9_]{2,60}$/.test(body.kind) ? body.kind : null;
      if (!kind) return bad("Choose the product list.");
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
        const result = await syncSalesDay(date, 30);
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

// ------------------------------------------------------------------

const KINDS: RuleKind[] = ["store_pool", "achievement", "abv", "bill_value", "wow", "product_units", "product_value"];
const num = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
};

/** Takes only the known fields of an incentive from the request. */
function cleanRule(raw: unknown, allowed: string[]): IncentiveRule | null {
  const r = (raw ?? {}) as Body;
  const kind = r.kind as RuleKind;
  if (!KINDS.includes(kind)) return null;
  const base = {
    id: String(r.id ?? ""),
    name: String(r.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
    groups: (Array.isArray(r.groups) ? r.groups : []).filter((g): g is IncentiveGroup => isGroup(g) && allowed.includes(g)),
    from: isDate(r.from) ? r.from : null,
    to: isDate(r.to) ? r.to : null,
  };
  const slabs = (Array.isArray(r.slabs) ? (r.slabs as Body[]) : []).slice(0, 20);
  switch (kind) {
    case "store_pool": {
      const split: Partial<Record<IncentiveGroup, number>> = {};
      for (const g of allowed) {
        const v = num(((r.split ?? {}) as Body)[g]);
        if (v > 0) split[g] = v;
      }
      return { ...base, kind, groups: allowed.filter((g) => (split[g] ?? 0) > 0), slabs: slabs.map((x) => ({ from: num(x.from), rate: num(x.rate) })), split };
    }
    case "achievement":
      return { ...base, kind, slabs: slabs.map((x) => ({ from: num(x.from), amount: num(x.amount) })) };
    case "product_value":
      return { ...base, kind, list: String(r.list ?? ""), slabs: slabs.map((x) => ({ from: num(x.from), amount: num(x.amount) })) };
    case "abv":
      return { ...base, kind, slabs: slabs.map((x) => ({ from: num(x.from), abv: num(x.abv), amount: num(x.amount) })) };
    case "bill_value":
      return { ...base, kind, minBill: num(r.minBill), amount: num(r.amount) };
    case "wow":
      return { ...base, kind, minBill: num(r.minBill), minItems: num(r.minItems), minCategories: num(r.minCategories), minCheap: num(r.minCheap), maxShare: num(r.maxShare), amount: num(r.amount) };
    case "product_units":
      return { ...base, kind, list: String(r.list ?? ""), amount: num(r.amount), freeNotDiscount: r.freeNotDiscount !== false };
  }
}
