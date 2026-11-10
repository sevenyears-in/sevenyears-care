import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";
import { loadIncentiveRules, loadPerformanceSettings } from "@/lib/performance-settings";
import { assignPtCodesForSavedBills } from "@/lib/sales-sync";
import { loadSalaries, loadStaffForPerformance, loadTargets, monthReport } from "@/lib/performance";
import { isMonth, monthRange } from "@/lib/performance-rules";
import { getStores } from "@/lib/stores";
import { PerformanceAdmin } from "@/components/PerformanceAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales targets & incentives" };

export default async function PerformanceSettingsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (!isAdmin(staff.role)) redirect("/staff");
  const sp = await searchParams;
  const thisMonth = todayISO().slice(0, 7);
  const month = isMonth(sp.m) ? sp.m : thisMonth;

  // Daily-wages salespeople (no employee code) get PT1, PT2 … before anything is shown.
  await assignPtCodesForSavedBills().catch(() => undefined);
  const [settings, people, targets, promos, storeList, report, counts, rules] = await Promise.all([
    loadPerformanceSettings(),
    loadStaffForPerformance(),
    loadTargets(month),
    supabaseAdmin.from("promo_products").select("id, kind, item_id, sku, name, from_date, to_date").order("name").limit(5000),
    getStores().catch(() => ({ stores: [] as { name: string }[] })),
    monthReport(month, true).catch(() => null),
    supabaseAdmin.from("sales_invoices").select("invoice_id", { count: "exact", head: true }).gte("invoice_date", monthRange(month).from).lte("invoice_date", monthRange(month).to),
    loadIncentiveRules(),
  ]);

  // PT staff: their store is where they sold most this month.
  const ptStore = new Map<string, string>();
  for (const s of report?.stores ?? []) for (const p of s.people) if (p.isPt) ptStore.set(p.userId, s.store);
  const ptPeople = Object.entries(settings.ptPeople)
    .sort(([a], [b]) => Number(a.slice(2)) - Number(b.slice(2)))
    .map(([code, p]) => ({ id: code, userId: code, name: p.name, store: ptStore.get(code) ?? null, homeStore: ptStore.get(code) ?? null, chosenStore: null, group: p.group ?? "sales", isPt: true }));

  const stores = [
    ...new Set([
      ...Object.keys(settings.storeTargets),
      ...((storeList as { stores: { name: string }[] }).stores ?? []).map((s) => s.name.toUpperCase()),
    ]),
  ].filter((s) => s && s !== "CORPORATE OFFICE");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">Settings</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Sales targets &amp; incentives</h1>
          <p className="mt-1 text-sm text-black/55">Targets, incentives, products, group names, discount limit and copying bills from Zoho POS.</p>
        </div>
        <Link href="/staff/performance?view=team" className="rounded-full bg-[#8883d7] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
          📈 Open the dashboard
        </Link>
      </div>
      <PerformanceAdmin
        month={month}
        thisMonth={thisMonth}
        today={todayISO()}
        settings={settings}
        stores={stores}
        people={[
          ...people.map((p) => {
            const chosen = settings.incentiveStores[p.userId] ?? null;
            const sold = (report?.stores ?? []).find((s) => s.people.some((x) => x.userId === p.userId))?.store ?? null;
            return { id: p.id, userId: p.userId, name: p.name, store: chosen ?? (p.store && p.store !== "CORPORATE OFFICE" ? p.store : sold), homeStore: p.store, chosenStore: chosen, group: p.group, isPt: false };
          }),
          ...ptPeople,
        ]}
        targets={Object.fromEntries([...targets.staff.entries()])}
        salaries={Object.fromEntries(await loadSalaries().catch(() => new Map<string, number>()))}
        storeMonthTargets={Object.fromEntries([...targets.stores.entries()])}
        promos={(promos.data ?? []) as { id: number; kind: "slow_moving" | "b2g1"; item_id: string | null; sku: string | null; name: string; from_date: string | null; to_date: string | null }[]}
        unlinked={report?.unlinked ?? []}
        billsCopied={counts.count ?? 0}
        lastBillDate={report?.lastBillDate ?? null}
        rules={rules}
      />
    </div>
  );
}
