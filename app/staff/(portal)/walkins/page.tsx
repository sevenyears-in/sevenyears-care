import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { monthReport } from "@/lib/performance";
import { istNow } from "@/lib/business-day";
import { hourlyWalkins, loadWalkins, walkinStores } from "@/lib/walkins";
import { WalkinCounter } from "@/components/WalkinCounter";

export const dynamic = "force-dynamic";
export const metadata = { title: "Walk-in counter" };

export default async function WalkinsPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  const sp = await searchParams;
  const day = istNow().date;
  const report = await monthReport(day.slice(0, 7)).catch(() => null);
  const all = (report?.stores ?? []).map((s) => s.store);
  const stores = await walkinStores(staff, all);
  if (!stores.length) redirect("/staff");
  const want = (sp.store ?? "").toUpperCase();
  const store = stores.includes(want) ? want : stores[0];
  const [w, hourly] = await Promise.all([loadWalkins(store, day), hourlyWalkins(store, day)]);
  const bills = report?.stores.find((s) => s.store === store)?.today.bills ?? 0;
  return <WalkinCounter key={store} store={store} stores={stores} day={day} startCount={w?.count ?? 0} startHourly={hourly} bills={bills} />;
}
