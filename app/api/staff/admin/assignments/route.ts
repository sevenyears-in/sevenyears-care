import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { attendanceCode } from "@/lib/attendance";
import { applyDueStores, forgetAssignments, loadAssignments, parseShiftReport, type ShiftDef } from "@/lib/assignments";
import { loadPerformanceSettings, savePerformanceSettings } from "@/lib/performance-settings";
import { forgetMonthReport } from "@/lib/performance";
import { readFirstSheet } from "@/lib/xlsx-read";

// Settings → Shifts & transfers: each person's shift and store over time ("valid from").

const isDay = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isTime = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const EARLIEST = "2000-01-01";

async function changed() {
  forgetAssignments();
  forgetMonthReport();
  await applyDueStores(true).catch(() => 0);
}

export async function GET() {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  if (!isAdmin(auth.staff.role)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const [{ data: staff }, all, settings] = await Promise.all([
    supabaseAdmin.from("staff_users").select("user_id, full_name, store_name, is_active").eq("is_active", true).order("full_name"),
    loadAssignments(true),
    loadPerformanceSettings(true),
  ]);
  const people = ((staff ?? []) as { user_id: string; full_name: string; store_name: string | null }[]).map((s) => {
    const code = attendanceCode(s.user_id);
    const a = all.get(code);
    return { userId: code, name: s.full_name, store: s.store_name ? s.store_name.toUpperCase() : null, shift: a?.shift ?? [], stores: a?.store ?? [] };
  });
  const stores = new Set<string>(Object.keys(settings.storeTargets).map((x) => x.toUpperCase()));
  for (const p of people) if (p.store) stores.add(p.store);
  const { openCloseStores } = await import("@/lib/store-open-close");
  for (const x of await openCloseStores().catch(() => [] as string[])) stores.add(x.toUpperCase());
  return NextResponse.json({ people, shifts: settings.shifts, grace: settings.lateGraceMinutes, stores: [...stores].sort() });
}

export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  if (!isAdmin(auth.staff.role)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const superAdmin = auth.staff.role === "super_admin";
  const by = auth.staff.fullName;

  // Excel upload (eTimeTrackLite → Employee Shift report).
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose the Excel file." }, { status: 400 });
    try {
      const parsed = parseShiftReport(readFirstSheet(Buffer.from(await file.arrayBuffer())));
      if (!parsed.people.length) return NextResponse.json({ error: "No rows with a shift and a Valid From date were found." }, { status: 400 });
      const settings = await loadPerformanceSettings(true);
      // Shifts: the report's shifts first (in order), then any others already here.
      const names = new Set(parsed.shifts.map((s) => s.name));
      const shifts: ShiftDef[] = [...parsed.shifts, ...settings.shifts.filter((s) => !names.has(s.name) && s.name !== "Regular")];
      await savePerformanceSettings({ shifts });
      const rows = parsed.people.map((p) => ({ user_id: p.userId, kind: "shift", value: p.shift, valid_from: p.validFrom, note: "From eTimeTrackLite shift report", created_by: by }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabaseAdmin.from("staff_assignments").upsert(rows.slice(i, i + 200), { onConflict: "user_id,kind,valid_from" });
        if (error) throw error;
      }
      await logAudit(auth.staff, "shifts", "import_excel", null, { shifts: parsed.shifts.length, people: rows.length }).catch(() => undefined);
      await changed();
      return NextResponse.json({ ok: true, shifts: parsed.shifts.length, people: rows.length, skipped: parsed.skipped });
    } catch (e) {
      console.error("Shift import error:", e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the file." }, { status: 400 });
    }
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.action === "shifts") {
      const list = Array.isArray(body.shifts) ? (body.shifts as Record<string, unknown>[]) : [];
      const shifts: ShiftDef[] = [];
      for (const s of list) {
        const name = String(s.name ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        if (!name) continue;
        if (!isTime(s.start) || (s.end && !isTime(s.end))) return NextResponse.json({ error: `Check the times of ${name}.` }, { status: 400 });
        if (shifts.some((x) => x.name.toUpperCase() === name.toUpperCase())) return NextResponse.json({ error: `Two shifts are called ${name}.` }, { status: 400 });
        shifts.push({ name, start: String(s.start), ...(s.end ? { end: String(s.end) } : {}) });
      }
      if (!shifts.length) return NextResponse.json({ error: "Keep at least one shift." }, { status: 400 });
      const grace = Math.round(Number(body.grace));
      if (!Number.isFinite(grace) || grace < 0 || grace > 180) return NextResponse.json({ error: "Grace minutes must be 0–180." }, { status: 400 });
      const before = await loadPerformanceSettings(true);
      await savePerformanceSettings({ shifts, lateGraceMinutes: grace });
      await logAudit(auth.staff, "shifts", "shifts", { shifts: before.shifts, grace: before.lateGraceMinutes }, { shifts, grace }).catch(() => undefined);
      await changed();
      return NextResponse.json({ ok: true });
    }

    if (body.action === "add") {
      const userId = attendanceCode(body.userId);
      const kind = body.kind === "store" ? "store" : body.kind === "shift" ? "shift" : null;
      const value = String(body.value ?? "").trim().toUpperCase();
      const validFrom = String(body.validFrom ?? "");
      const note = String(body.note ?? "").trim().slice(0, 200) || null;
      if (!userId || !kind || !value || !isDay(validFrom)) return NextResponse.json({ error: "Choose the person, the new " + (kind ?? "value") + " and the date." }, { status: 400 });
      if (kind === "shift") {
        const settings = await loadPerformanceSettings();
        if (!settings.shifts.some((s) => s.name.toUpperCase() === value)) return NextResponse.json({ error: "Choose one of the shifts." }, { status: 400 });
      }
      const all = await loadAssignments(true);
      const rows: Record<string, unknown>[] = [];
      // First transfer of a person: remember where they were before, so earlier days stay there.
      if (kind === "store" && !(all.get(userId)?.store.length)) {
        const fromStore = String(body.fromStore ?? "").trim().toUpperCase();
        if (!fromStore) return NextResponse.json({ error: "Choose the store the person was in before." }, { status: 400 });
        if (fromStore === value) return NextResponse.json({ error: "The new store is the same as the old one." }, { status: 400 });
        rows.push({ user_id: userId, kind, value: fromStore, valid_from: EARLIEST, note: "Store before the first transfer", created_by: by });
      }
      rows.push({ user_id: userId, kind, value, valid_from: validFrom, note, created_by: by });
      const { error } = await supabaseAdmin.from("staff_assignments").upsert(rows, { onConflict: "user_id,kind,valid_from" });
      if (error) throw error;
      await logAudit(auth.staff, "shifts", `add_${kind}`, null, { userId, value, validFrom, note }).catch(() => undefined);
      await changed();
      return NextResponse.json({ ok: true });
    }

    if (body.action === "update") {
      const id = Number(body.id);
      const value = String(body.value ?? "").trim().toUpperCase();
      const validFrom = String(body.validFrom ?? "");
      if (!id || !value || !isDay(validFrom)) return NextResponse.json({ error: "Check the value and the date." }, { status: 400 });
      const { data: before } = await supabaseAdmin.from("staff_assignments").select("*").eq("id", id).maybeSingle();
      if (!before) return NextResponse.json({ error: "Not found." }, { status: 404 });
      const { error } = await supabaseAdmin
        .from("staff_assignments")
        .update({ value, valid_from: validFrom, note: String(body.note ?? "").trim().slice(0, 200) || null })
        .eq("id", id);
      if (error) return NextResponse.json({ error: error.code === "23505" ? "There is already a change on that date." : "Could not save." }, { status: 400 });
      await logAudit(auth.staff, "shifts", "update", before, { value, validFrom }).catch(() => undefined);
      await changed();
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete") {
      if (!superAdmin) return NextResponse.json({ error: "Only the Super Admin can delete." }, { status: 403 });
      const id = Number(body.id);
      const { data: before } = await supabaseAdmin.from("staff_assignments").select("*").eq("id", id).maybeSingle();
      if (!before) return NextResponse.json({ error: "Not found." }, { status: 404 });
      const { error } = await supabaseAdmin.from("staff_assignments").delete().eq("id", id);
      if (error) throw error;
      await logAudit(auth.staff, "shifts", "delete", before, null).catch(() => undefined);
      await changed();
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    console.error("Assignments error:", error);
    return NextResponse.json({ error: "Could not save. (Has supabase/staff-assignments.sql been run?)" }, { status: 500 });
  }
}
