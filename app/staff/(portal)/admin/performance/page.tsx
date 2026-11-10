import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";
import { loadPerformanceSettings } from "@/lib/performance-settings";
import { loadStaffForPerformance, loadTargets, monthReport } from "@/lib/performance";
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

  const [settings, people, targets, promos, storeList, report, counts] = await Promise.all([
    loadPerformanceSettings(),
    loadStaffForPerformance(),
    loadTargets(month),
    supabaseAdmin.from("promo_products").select("id, kind, item_id, sku, name, from_date, to_date").order("name").limit(5000),
    getStores().catch(() => ({ stores: [] as { name: string }[] })),
    monthReport(month, true).catch(() => null),
    supabaseAdmin.from("sales_invoices").select("invoice_id", { count: "exact", head: true }).gte("invoice_date", monthRange(month).from).lte("invoice_date", monthRange(month).to),
  ]);

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
          <p className="mt-1 text-sm text-black/55">Targets, discount limit, Slow-moving and Buy 2 Get 1 products, and copying bills from Zoho POS.</p>
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
        people={people.map((p) => ({ id: p.id, userId: p.userId, name: p.name, roleLabel: p.roleLabel, store: p.store, group: p.group, groupChosen: p.groupChosen }))}
        targets={Object.fromEntries([...targets.staff.entries()])}
        storeMonthTargets={Object.fromEntries([...targets.stores.entries()])}
        promos={(promos.data ?? []) as { id: number; kind: "slow_moving" | "b2g1"; item_id: string | null; sku: string | null; name: string; from_date: string | null; to_date: string | null }[]}
        unlinked={report?.unlinked ?? []}
        billsCopied={counts.count ?? 0}
        lastBillDate={report?.lastBillDate ?? null}
      />
    </div>
  );
}
