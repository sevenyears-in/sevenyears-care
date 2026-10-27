import Link from "next/link";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zohoConfigured } from "@/lib/zoho";
import { todayISO } from "@/lib/helpers";

export default async function StaffDashboard() {
  const staff = await getCurrentStaff();
  const today = todayISO();

  const [todayCount, totalCount, categoryCount, openService] = await Promise.all([
    supabaseAdmin
      .from("warranties")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${today}T00:00:00+05:30`),
    supabaseAdmin.from("warranties").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("warranty_categories")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabaseAdmin
      .from("service_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "assigned", "in_progress", "awaiting_parts"]),
  ]);

  const demo = !(await zohoConfigured());
  const noCategories = (categoryCount.count ?? 0) === 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-[#ff5e79]">Welcome back</p>
        <h1 className="mt-1 text-3xl font-bold">{staff?.fullName}</h1>
      </div>

      {demo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">Zoho POS is not connected yet — demo mode</p>
          <p className="mt-1">
            Fetching any bill number returns a sample bill so you can try the screens.
            {staff?.role === "admin" ? (
              <>
                {" "}
                <Link href="/staff/admin/zoho" className="font-bold underline">
                  Connect Zoho POS
                </Link>{" "}
                to fetch real bills.
              </>
            ) : (
              " Ask your administrator to connect Zoho POS."
            )}
          </p>
        </div>
      )}

      {noCategories && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-bold">No warranty categories set up</p>
          <p className="mt-1">
            Items only appear for registration when their Zoho POS category is in the
            warranty list.{" "}
            {staff?.role === "admin" ? (
              <Link href="/staff/admin/categories" className="font-bold underline">
                Add categories now
              </Link>
            ) : (
              "Ask your administrator to add them."
            )}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Registered today" value={todayCount.count ?? 0} />
        <Stat label="Total warranties" value={totalCount.count ?? 0} />
        <Stat label="Open service requests" value={openService.count ?? 0} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/staff/register"
          className="rounded-3xl bg-[#161616] p-6 text-white transition hover:opacity-95"
        >
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/50">Main task</p>
          <h2 className="mt-2 text-2xl font-bold">Register Warranty</h2>
          <p className="mt-2 text-sm text-white/60">
            Fetch the bill from Zoho POS, fill model and serial numbers, and generate certificates.
          </p>
          <span className="mt-5 inline-block rounded-2xl bg-[#ff5e79] px-5 py-3 text-sm font-bold">
            Start →
          </span>
        </Link>

        <Link
          href="/staff/warranties"
          className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5 transition hover:shadow-md"
        >
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-black/40">Look up</p>
          <h2 className="mt-2 text-2xl font-bold">Find a Warranty</h2>
          <p className="mt-2 text-sm text-black/55">
            Search by bill number, warranty number, mobile or serial number and re-download certificates.
          </p>
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <p className="text-xs font-semibold uppercase tracking-wider text-black/40">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}
