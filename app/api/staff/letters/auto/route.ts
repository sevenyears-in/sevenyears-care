import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  canControl,
  controlCase,
  controlStores,
  loadDisciplineSettings,
  runDiscipline,
  saveDisciplineSettings,
  type DisciplineSettings,
} from "@/lib/discipline";

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
      const r = (s.rules ?? {}) as Partial<DisciplineSettings["rules"]>;
      const threshold = Number(r.performance?.threshold);
      if (!(threshold > 0 && threshold <= 100)) return NextResponse.json({ error: "The performance limit must be between 1 and 100%." }, { status: 400 });
      if (!isDay(r.sop_sm?.from) || !isDay(r.late?.from) || !isMonth(r.performance?.from)) return NextResponse.json({ error: "Fill in the 'count from' dates." }, { status: 400 });
      const next: DisciplineSettings = {
        rules: {
          sop_sm: { on: Boolean(r.sop_sm?.on), from: r.sop_sm.from },
          late: { on: Boolean(r.late?.on), from: r.late.from },
          performance: { on: Boolean(r.performance?.on), from: r.performance.from, threshold: Math.round(threshold) },
        },
        signer: typeof s.signer === "string" && s.signer ? s.signer : null,
        controllers: Array.isArray(s.controllers) ? [...new Set(s.controllers.filter((x): x is string => typeof x === "string"))].slice(0, 50) : [],
      };
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
