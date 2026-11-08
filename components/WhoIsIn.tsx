import { supabaseAdmin } from "@/lib/supabase/server";
import { attendanceCode, presenceToday, recentAttendanceCodes } from "@/lib/attendance";
import { isCorporateStaff, ROLE_LABELS, sameStore, asRole } from "@/lib/roles";
import { loadAccessConfig } from "@/lib/access-config";
import type { StaffUser } from "@/lib/auth";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

const STORE_COLOURS = ["#ff5e79", "#8883d7", "#0fa8bf", "#f39237", "#16a34a"];

/** Display order inside each store: Store Manager, Assistant Store Manager, Floor Manager, CRE, CSA, Technician, then others. */
function rankOf(label: string) {
  const l = label.toLowerCase();
  if (/assist|asst/.test(l) && /manager/.test(l)) return 2;
  if (/store manager/.test(l)) return 1;
  if (/floor/.test(l)) return 3;
  if (/\bcre\b/.test(l)) return 4;
  if (/\bcsa\b/.test(l)) return 5;
  if (/technician/.test(l)) return 6;
  return 7;
}

/** Dashboard card: who is in each store right now (eTimeTrackLite punches). */
export async function WhoIsIn({ staff }: { staff: StaffUser }) {
  const { data } = await supabaseAdmin
    .from("staff_users")
    .select("id, user_id, full_name, role, store_name, custom_role_id")
    .eq("is_active", true)
    .order("full_name");
  // Only staff whose User ID is used on the punching machine (punched in the last month).
  const codes = await recentAttendanceCodes();
  const config = await loadAccessConfig().catch(() => null);
  const people = (
    (data ?? []) as { id: string; user_id: string; full_name: string; role: string; store_name: string | null; custom_role_id: string | null }[]
  )
    .filter((p) => codes.has(attendanceCode(p.user_id)))
    .map((p) => {
      // A custom role (e.g. "Assistant Store Manager") shows its own name.
      const custom = p.custom_role_id ? config?.custom.find((c) => c.id === p.custom_role_id) : undefined;
      const label = custom?.name ?? ROLE_LABELS[asRole(p.role)];
      return { ...p, label, rank: rankOf(label) };
    });
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
          // Only people who are in right now.
          const rows = members
            .map((m) => ({ ...m, p: presence.get(m.id) }))
            .filter((r): r is typeof r & { p: NonNullable<typeof r.p> } => r.p?.status === "in")
            .sort((a, b) => a.rank - b.rank || a.full_name.localeCompare(b.full_name));
          const colour = STORE_COLOURS[i % STORE_COLOURS.length];
          return (
            <div key={store} className="relative overflow-hidden rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5">
              <span className="absolute inset-y-5 left-0 w-1 rounded-r-full" style={{ backgroundColor: colour }} aria-hidden />
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-bold">{store}</p>
                <p className="text-sm font-bold" style={{ color: colour }}>
                  {rows.length} in
                </p>
              </div>
              {rows.length === 0 ? (
                <p className="mt-3 text-sm text-black/45">Nobody in yet</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {rows.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" aria-hidden />
                        <span className="truncate font-semibold">{r.full_name}</span>
                        <span className="hidden shrink-0 text-xs text-black/35 sm:inline">{r.label}</span>
                      </span>
                      <span className="shrink-0 text-xs text-black/50">In since {time(r.p.firstIn)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
