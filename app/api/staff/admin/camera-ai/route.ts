import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { supabaseAdmin } from "@/lib/supabase/server";
import { istNow } from "@/lib/business-day";
import {
  aiLastError,
  aiProvider,
  checkDoorPhoto,
  cleanAi,
  deleteWatch,
  listWatch,
  loadAiSettings,
  markCounts,
  saveAiSettings,
  saveWatch,
  sendWatchReports,
  watchPhotoUrl,
} from "@/lib/camera-ai";

// Settings → Attendance → CCTV → AI photo check and People to watch (Super Admin).
// GET → settings, status, people to watch, staff to choose from.
// POST { action: "settings", settings } | { action: "save", person } | { action: "delete", id }
//      | { action: "test", id?, model? } (check the latest doorway photo, or photo id, now) | { action: "report", id } (send today's e-mail now)

export async function GET() {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const day = istNow().date;
  const dayStart = new Date(Date.parse(`${day}T00:00:00+05:30`)).toISOString();
  const [settings, people, staff, checked, learned] = await Promise.all([
    loadAiSettings(),
    listWatch().catch(() => null),
    supabaseAdmin.from("staff_users").select("id, full_name, store_name").eq("is_active", true).order("full_name"),
    supabaseAdmin.from("cctv_events").select("id", { count: "exact", head: true }).gte("ai_at", dayStart),
    markCounts().catch(() => ({})),
  ]);
  return NextResponse.json({
    settings,
    provider: aiProvider(),
    lastError: aiLastError(),
    checkedToday: checked.count ?? 0,
    learned,
    ready: people !== null,
    people: people ? await Promise.all(people.map(async (p) => ({ ...p, photoUrl: await watchPhotoUrl(p.photo_path) }))) : [],
    staff: ((staff.data ?? []) as { id: string; full_name: string; store_name: string | null }[]).map((s) => ({ id: s.id, name: s.full_name, store: (s.store_name ?? "").toUpperCase() })),
  });
}

export async function POST(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.action === "settings") {
      const before = await loadAiSettings();
      const next = cleanAi(body.settings);
      await saveAiSettings(next);
      await logAudit(auth.staff, "camera_ai", "settings", before, next).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "save") {
      const p = (body.person ?? {}) as Record<string, unknown>;
      const id = await saveWatch({
        id: typeof p.id === "string" && p.id ? p.id : undefined,
        staff_id: typeof p.staff_id === "string" ? p.staff_id : null,
        name: String(p.name ?? ""),
        store: String(p.store ?? ""),
        emails: String(p.emails ?? ""),
        active: p.active !== false,
        photoB64: typeof p.photoB64 === "string" ? p.photoB64 : null,
      });
      await logAudit(auth.staff, "camera_ai", "watch_save", null, { id, name: p.name, store: p.store }).catch(() => undefined);
      return NextResponse.json({ ok: true, id });
    }
    if (body.action === "delete" && typeof body.id === "string") {
      await deleteWatch(body.id);
      await logAudit(auth.staff, "camera_ai", "watch_delete", null, { id: body.id }).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "test") {
      if (!aiProvider()) return NextResponse.json({ error: "No AI key in the hosting yet (ANTHROPIC_API_KEY or OPENAI_API_KEY)." }, { status: 400 });
      const { loadCctv, CCTV_BUCKET } = await import("@/lib/cctv");
      const { watch } = await loadCctv(true);
      if (!watch.walkinCode) return NextResponse.json({ error: "The doorway line code is not set (CCTV → Walk-ins from the camera)." }, { status: 400 });
      // { id } checks that photo; otherwise the latest doorway photo. { model } tries another model (not saved).
      let q = supabaseAdmin.from("cctv_events").select("id, store, event_at, photo_path").not("photo_path", "is", null);
      q = typeof body.id === "number" ? q.eq("id", body.id) : q.filter("raw->sub_type", "cs", `[${watch.walkinCode}]`);
      const { data } = await q.order("event_at", { ascending: false }).limit(1).maybeSingle();
      const e = data as { id: number; store: string; event_at: string; photo_path: string } | null;
      if (!e) return NextResponse.json({ error: "No doorway photo yet." }, { status: 400 });
      const { data: blob } = await supabaseAdmin.storage.from(CCTV_BUCKET).download(e.photo_path);
      if (!blob) return NextResponse.json({ error: "The photo could not be read." }, { status: 400 });
      const result = await checkDoorPhoto(blob, await loadAiSettings(), [], typeof body.model === "string" ? body.model.trim().slice(0, 80) : undefined, e.store);
      const { data: signed } = await supabaseAdmin.storage.from(CCTV_BUCKET).createSignedUrl(e.photo_path, 600);
      return NextResponse.json({ ok: true, store: e.store, at: e.event_at, photoUrl: signed?.signedUrl ?? null, result });
    }
    if (body.action === "report" && typeof body.id === "string") {
      const n = await sendWatchReports(istNow().date, body.id);
      return NextResponse.json({ ok: true, sent: n });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: /relation|does not exist|schema cache|column/i.test(message) ? "The database update for the AI photo check has not been run yet." : message }, { status: 400 });
  }
}
