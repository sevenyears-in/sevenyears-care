import { supabaseAdmin } from "@/lib/supabase/server";
import { presenceToday } from "@/lib/attendance";
import { isCorporateStaff, ROLE_LABELS, sameStore, asRole } from "@/lib/roles";
import type { StaffUser } from "@/lib/auth";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

const STORE_COLOURS = ["#ff5e79", "#8883d7", "#0fa8bf", "#f39237", "#16a34a"];

/** Dashboard card: who is in each store right now (eTimeTrackLite punches). */
export async function WhoIsIn({ staff }: { staff: StaffUser }) {
  const { data } = await supabaseAdmin
    .from("staff_users")
    .select("id, full_name, role, store_name")
    .eq("is_active", true)
    .not("employee_code", "is", null)
    .order("full_name");
  const people = (data ?? []) as { id: string; full_name: string; role: string; store_name: string | null }[];
  if (people.length === 0) return null;

  const all = isCorporateStaff(staff) || staff.access?.allStores;
  const presence = await presenceToday();
  const stores = new Map<string, typeof people>();
  for (const p of people) {
    const store = p.store_name || "CORPORATE OFFICE";
    if (!all && !sameStore(store, staff.storeName)) continue;
    stores.set(store, [...(stores.get(store) ?? []), p]);
  }
  if (stores.size === 0) return null;
  const list = [...stores.entries()].sort(([a], [b]) => (a === "CORPORATE OFFICE" ? 1 : b === "CORPORATE OFFICE" ? -1 : a.localeCompare(b)));

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-bold">Who&apos;s in today</h2>
        <p className="text-xs text-black/45">From eTimeTrackLite · updates every 2 minutes</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {list.map(([store, members], i) => {
          const rows = members
            .map((m) => ({ ...m, p: presence.get(m.id) }))
            .sort((a, b) => {
              const rank = (x: typeof a) => (x.p?.status === "in" ? 0 : x.p ? 1 : 2);
              return rank(a) - rank(b) || a.full_name.localeCompare(b.full_name);
            });
          const inNow = rows.filter((r) => r.p?.status === "in").length;
          const colour = STORE_COLOURS[i % STORE_COLOURS.length];
          return (
            <div key={store} className="relative overflow-hidden rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5">
              <span className="absolute inset-y-5 left-0 w-1 rounded-r-full" style={{ backgroundColor: colour }} aria-hidden />
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-bold">{store}</p>
                <p className="text-sm font-bold" style={{ color: colour }}>
                  {inNow} / {rows.length} in
                </p>
              </div>
              <ul className="mt-3 space-y-1.5">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                          r.p?.status === "in" ? "bg-green-500" : r.p ? "bg-amber-400" : "bg-black/15"
                        }`}
                        aria-hidden
                      />
                      <span className={`truncate ${r.p?.status === "in" ? "font-semibold" : "text-black/50"}`}>{r.full_name}</span>
                      <span className="hidden shrink-0 text-xs text-black/35 sm:inline">{ROLE_LABELS[asRole(r.role)]}</span>
                    </span>
                    <span className="shrink-0 text-xs text-black/50">
                      {r.p?.status === "in" ? `In since ${time(r.p.firstIn)}` : r.p ? `Left ${time(r.p.lastPunch)}` : "Not in"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
