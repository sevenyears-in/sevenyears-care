// Part-time (temporary, daily-wages) salespeople (server only). They have no login: each has a
// PT code (PT1, PT2 …) in the sales settings, made automatically from a new Zoho POS salesperson
// name, or added by hand (Shifts, targets & transfers) so a target can be set before their
// first bill. Their store in a month: the store chosen for them (Settings → Targets, or the Store
// Manager who added them), else where they billed most that month, else the month before.

import { supabaseAdmin } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { loadPerformanceSettings, savePerformanceSettings } from "@/lib/performance-settings";
import { ptStoreIn, type PtPerson } from "@/lib/performance-rules";
import { forgetMonthReport } from "@/lib/performance";

const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};
const monthEnd = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};

export type PtStaff = { code: string; name: string; store: string | null; chosen: boolean };

/** Every part-time person with their store in the month. */
export async function ptStaffIn(month: string): Promise<PtStaff[]> {
  const settings = await loadPerformanceSettings();
  const people = settings.ptPeople as Record<string, PtPerson>;
  const codes = Object.keys(people);
  if (!codes.length) return [];
  const pm = prevMonth(month);
  const unchosen = codes.filter((c) => !ptStoreIn(people[c], month));
  // Where each one billed most: this month first, else last month.
  const most = new Map<string, string>();
  if (unchosen.length) {
    const rows = await fetchAll<{ staff_user_id: string; store: string | null; invoice_date: string; net: number | null }>((a, b) =>
      supabaseAdmin
        .from("sales_invoices")
        .select("staff_user_id, store, invoice_date, net")
        .in("staff_user_id", unchosen)
        .gte("invoice_date", `${pm}-01`)
        .lte("invoice_date", monthEnd(month))
        .order("invoice_id")
        .range(a, b)
    ).catch(() => []);
    for (const which of [month, pm]) {
      const sums = new Map<string, Map<string, number>>();
      for (const r of rows) {
        if (!r.store || !r.invoice_date.startsWith(which) || most.has(r.staff_user_id)) continue;
        const m = sums.get(r.staff_user_id) ?? new Map<string, number>();
        m.set(r.store.toUpperCase(), (m.get(r.store.toUpperCase()) ?? 0) + Number(r.net ?? 0));
        sums.set(r.staff_user_id, m);
      }
      for (const [code, m] of sums) most.set(code, [...m.entries()].sort((x, y) => y[1] - x[1])[0][0]);
    }
  }
  return codes
    .map((code) => {
      const chosen = ptStoreIn(people[code], month);
      return { code, name: people[code].name, store: chosen ?? most.get(code) ?? null, chosen: Boolean(chosen) };
    })
    .sort((a, b) => Number(a.code.slice(2)) - Number(b.code.slice(2)));
}

/**
 * Adds a part-time person by name, in a store from this month on. Their Zoho POS salesperson
 * name must be the same, so their bills are counted for them. A name already known is put in
 * the store (if it has none this month) instead of being added twice.
 */
export async function addPtPerson(rawName: string, store: string, month: string): Promise<{ code: string; added: boolean } | { error: string }> {
  const name = rawName.replace(/\s+/g, " ").trim().toUpperCase();
  if (name.length < 3) return { error: "Enter the name as it is in Zoho POS (salesperson)." };
  const s = await loadPerformanceSettings(true);
  const links = Object.fromEntries(Object.entries(s.salespersonLinks ?? {}).map(([k, v]) => [k.toUpperCase(), v]));
  const people = { ...(s.ptPeople as Record<string, PtPerson>) };
  const existing = links[name] ?? Object.entries(people).find(([, p]) => p.name.toUpperCase() === name)?.[0];
  if (existing && !/^PT\d+$/.test(existing)) return { error: `${name} is a staff member with a login (User ID ${existing}), not a part-time person.` };
  if (existing) {
    const now = (await ptStaffIn(month)).find((p) => p.code === existing);
    if (now?.store && now.store !== store) return { error: `${name} (${existing}) is already in ${now.store} this month. Ask the Super Admin to change their store.` };
    people[existing] = { ...people[existing], stores: { ...(people[existing].stores ?? {}), [month]: store } };
    await savePerformanceSettings({ ptPeople: people });
    forgetMonthReport();
    return { code: existing, added: false };
  }
  const last = Math.max(0, ...[...Object.keys(people), ...Object.values(links)].map((c) => (/^PT(\d+)$/.exec(c) ? Number(/^PT(\d+)$/.exec(c)![1]) : 0)));
  const code = `PT${last + 1}`;
  people[code] = { name, stores: { [month]: store } };
  links[name] = code;
  await savePerformanceSettings({ ptPeople: people, salespersonLinks: links });
  forgetMonthReport();
  return { code, added: true };
}
