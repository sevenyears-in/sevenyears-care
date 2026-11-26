import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  canControl,
  cleanSettings,
  controlCase,
  LIMITS,
  TRACKS,
  controlStores,
  loadDisciplineSettings,
  runDiscipline,
  saveDisciplineSettings,
  type DisciplineSettings,
} from "@/lib/discipline";

const LABELS: Record<string, string> = {
  count: "The number of times",
  days: "The number of days",
  run: "Late days in a row",
  minutes: "Late minutes",
  threshold: "The % of target",
  months: "Poor months in a row",
  pipDays: "PIP days",
  stepDays: "Days for each warning",
  openDays: "Days a point may stay Open",
  progressDays: "Days a point may stay In progress",
  gapMinutes: "Minutes without walk-ins",
};

// Automatic letters (Warning letters → Automatic letters).
// POST { action: "settings", settings }            — Super Admin: rules on / off, dates, signer, who has the controls
//      { action: "preview" }                       — what today's run would do (nothing is sent)
//      { action: "run" }                           — Super Admin: run now (sends what is due)
//      { action: "pause" | "resume" | "reset", staffId, track, note }

const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m);

export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const me = auth.staff;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const settings = await loadDisciplineSettings();
    if (!canControl(me, settings)) return NextResponse.json({ error: "You don't have the controls for automatic letters." }, { status: 403 });

    if (body.action === "settings") {
      if (me.role !== "super_admin") return NextResponse.json({ error: "Only the Super Admin can change the rules." }, { status: 403 });
      const s = (body.settings ?? {}) as Partial<DisciplineSettings>;
      const r = (s.rules ?? {}) as Record<string, Record<string, unknown>>;
      // Every number must be within its limits (no silent changes).
      for (const [rule, fields] of Object.entries(LIMITS)) {
        if (rule === "performance" ? !isMonth(r[rule]?.from) : !isDay(r[rule]?.from)) return NextResponse.json({ error: "Fill in the 'count from' dates." }, { status: 400 });
        for (const [name, [lo, hi]] of Object.entries(fields as Record<string, readonly [number, number]>)) {
          const n = Number(r[rule]?.[name]);
          if (!Number.isFinite(n) || n < lo || n > hi) return NextResponse.json({ error: `${LABELS[name] ?? name} (${TRACKS[rule as keyof typeof TRACKS]}) must be between ${lo} and ${hi}.` }, { status: 400 });
        }
      }
      const next = cleanSettings(s);
      await saveDisciplineSettings(next);
      await logAudit(me, "discipline", "settings", settings, next).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "preview" || body.action === "run") {
      if (body.action === "run" && me.role !== "super_admin") return NextResponse.json({ error: "Only the Super Admin can run it now." }, { status: 403 });
      const r = await runDiscipline({ dryRun: body.action === "preview", by: me.fullName });
      const stores = controlStores(me);
      const actions = r.actions
        .filter((a) => !stores || (a.store && stores.includes(a.store.toUpperCase())))
        .map((a) => ({ track: a.track, staffId: a.staffId, name: a.name, store: a.store, what: a.what, kind: a.kind ?? null, needs: a.needs ?? null, subject: a.subject ?? null, body: a.body ?? null }));
      if (body.action === "run") await logAudit(me, "discipline", "run", null, { summary: r.summary }).catch(() => undefined);
      return NextResponse.json({ ok: true, actions, summary: r.summary, errors: r.errors });
    }

    if (body.action === "pause" || body.action === "resume" || body.action === "reset") {
      const c = await controlCase(me, { action: body.action, staffId: String(body.staffId ?? ""), track: String(body.track ?? ""), note: String(body.note ?? "") });
      await logAudit(me, "discipline", body.action, null, { staff: c.staff_name, track: c.track, note: body.note ?? null }).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    console.error("Automatic letters error:", error);
    return NextResponse.json({ error: /relation|does not exist|schema cache/i.test(message) ? "The database update for automatic letters has not been run yet." : message }, { status: 400 });
  }
}
