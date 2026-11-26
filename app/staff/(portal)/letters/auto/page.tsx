import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/helpers";
import type { Role } from "@/lib/roles";
import { canControl, controlStores, disciplineOverview, loadDisciplineSettings, nextStep, STAGES, TRACKS } from "@/lib/discipline";
import { DisciplinePanel } from "@/components/DisciplinePanel";

export const dynamic = "force-dynamic";

// Automatic letters: the rules, the people in each step, and the manual controls.
export default async function AutomaticLettersPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  const settings = await loadDisciplineSettings();
  if (!canControl(staff, settings)) notFound();
  const { cases, events, runs, ready } = await disciplineOverview(staff);
  const stores = controlStores(staff);

  const { data } = await supabaseAdmin.from("staff_users").select("id, full_name, role, store_name").eq("is_active", true).order("full_name");
  const all = ((data ?? []) as { id: string; full_name: string; role: Role; store_name: string | null }[]).map((s) => ({
    id: s.id,
    name: s.full_name,
    role: s.role,
    store: s.store_name ? s.store_name.toUpperCase() : null,
  }));
  const people = all.filter((p) => p.role !== "super_admin" && p.role !== "director" && (!stores || (p.store && stores.includes(p.store))));
  const signers = all.filter((p) => ["super_admin", "hr_head", "director"].includes(p.role));
  const controllerChoices = all.filter((p) => ["hr_executive", "hr_head", "store_manager"].includes(p.role));

  const rows = cases.map((c) => ({
    id: c.id,
    staffId: c.staff_id,
    name: c.staff_name,
    code: c.user_id,
    store: c.store,
    track: c.track,
    trackLabel: TRACKS[c.track] ?? c.track,
    stage: STAGES[c.stage] ?? c.stage,
    status: c.status,
    next: nextStep(c),
    note: c.note,
    updated: formatDateTime(c.updated_at),
    history: events
      .filter((e) => e.case_id === c.id)
      .slice(0, 8)
      .map((e) => ({ at: formatDateTime(e.at), note: e.note ?? e.action, by: e.by_name, letterId: e.letter_id })),
  }));

  return (
    <div className="space-y-8">
      <div>
        <Link href="/staff/letters" className="text-sm font-semibold text-[#11b8d0] hover:underline">
          ← Warning letters
        </Link>
        <h1 className="mt-3 text-3xl font-bold">Automatic letters</h1>
        <p className="mt-2 text-sm text-black/60">
          Every morning after 11 am, Care checks its records and sends the letters that are due, in the name of the signer below. Final warnings and termination
          letters are only prepared: they wait for the Super Admin to check them and send them.
        </p>
      </div>
      {!ready && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">The database update for automatic letters has not been run yet.</p>
      )}
      <DisciplinePanel
        superAdmin={staff.role === "super_admin"}
        settings={settings}
        people={people.map((p) => ({ id: p.id, name: p.name, store: p.store }))}
        signers={signers.map((p) => ({ id: p.id, name: p.name }))}
        controllerChoices={controllerChoices.map((p) => ({ id: p.id, name: p.name, role: p.role, store: p.store }))}
        cases={rows}
        runs={runs.map((r) => ({ day: formatDate(r.day), result: r.result ?? (r.finished_at ? "" : "running…") }))}
      />
    </div>
  );
}
