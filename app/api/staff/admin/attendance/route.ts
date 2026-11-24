import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";
import { attendanceCode, attendanceSettings, hashKey, machineEmployees, newSyncKey, saveAttendanceSettings } from "@/lib/attendance";
import { fetchAll } from "@/lib/fetch-all";
import { deviceStores, listDevices, setDeviceStore } from "@/lib/store-open-close";
import { getStores } from "@/lib/stores";

// Settings → Attendance (Super Admin).
// GET  → status (last sync, punches today, codes not linked to a staff user)
// POST { action: "newKey" } → a new sync key, shown once (the old one stops working)
// POST { action: "backfill", from } → the office PC sends all punches from that day at its next run
// POST { action: "hideCode", code, note } / { action: "showCode", code } → leave a machine code out of
//      "On the punching machine, not in the app" (e.g. an old code of someone who rejoined)

/** A role from the eTimeTrackLite designation (the person adding them can change it). */
function roleFrom(designation: string): string {
  const d = designation.toLowerCase();
  if (/store\s*manager|\bsm\b|branch\s*manager/.test(d)) return "store_manager";
  if (/\basm\b|asst|assistant\s*manager|floor/.test(d)) return "floor_incharge";
  if (/tech|service\s*eng/.test(d)) return "technician";
  if (/\bcre\b|customer\s*rel/.test(d)) return "cre";
  if (/\bhr\b|human/.test(d)) return "hr_executive";
  return "csa";
}

const HIDDEN_KEY = "attendance_hidden_codes";
type Hidden = Record<string, { note: string; by: string; at: string }>;

async function hiddenCodes(): Promise<Hidden> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", HIDDEN_KEY).maybeSingle();
  return ((data?.value ?? {}) as Hidden) || {};
}

/**
 * People who punched in the last 45 days but have no staff account (User ID = employee code),
 * with their name from eTimeTrackLite and the store of the machine they punch on most.
 */
async function notInApp() {
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const [punches, staff, machines, emps, hidden] = await Promise.all([
    fetchAll<{ emp_code: string; device: string | null; punch_time: string }>((a, b) =>
      supabaseAdmin.from("attendance_punches").select("emp_code, device, punch_time").gte("punch_time", since).order("id").range(a, b)
    ),
    supabaseAdmin.from("staff_users").select("user_id"),
    deviceStores().catch(() => ({}) as Record<string, string>),
    machineEmployees(),
    hiddenCodes().catch(() => ({}) as Hidden),
  ]);
  const have = new Set((staff.data ?? []).map((s) => attendanceCode(s.user_id)));
  for (const c of Object.keys(hidden)) have.add(attendanceCode(c));
  const byCode = new Map<string, { punches: number; last: string; devices: Map<string, number> }>();
  for (const p of punches) {
    const code = attendanceCode(p.emp_code);
    if (!code || have.has(code)) continue;
    const cur = byCode.get(code) ?? { punches: 0, last: p.punch_time, devices: new Map<string, number>() };
    cur.punches++;
    if (p.punch_time > cur.last) cur.last = p.punch_time;
    if (p.device) cur.devices.set(p.device, (cur.devices.get(p.device) ?? 0) + 1);
    byCode.set(code, cur);
  }
  const info = new Map(emps.list.map((e) => [e.code, e]));
  const list = [...byCode.entries()].map(([code, x]) => {
    const device = [...x.devices.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const e = info.get(code);
    return {
      code,
      name: e?.name ?? "",
      designation: e?.designation ?? "",
      department: e?.department ?? "",
      status: e?.status ?? "",
      store: device ? machines[device] ?? "" : "",
      role: roleFrom(e?.designation ?? ""),
      punches: x.punches,
      lastPunch: x.last,
    };
  });
  list.sort((a, b) => b.lastPunch.localeCompare(a.lastPunch));
  return { list, namesAt: emps.at, hidden: Object.entries(hidden).map(([code, h]) => ({ code, ...h })) };
}

export async function GET() {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const [settings, punches, staff, devices, storeList, missing] = await Promise.all([
    attendanceSettings(),
    supabaseAdmin
      .from("attendance_punches")
      .select("emp_code")
      .gte("punch_time", `${todayISO()}T00:00:00+05:30`)
      .limit(5000),
    supabaseAdmin.from("staff_users").select("user_id").eq("is_active", true),
    listDevices().catch(() => []),
    getStores().catch(() => null),
    notInApp().catch(() => ({ list: [], namesAt: null, hidden: [] })),
  ]);
  const userIds = new Set((staff.data ?? []).map((s) => attendanceCode(s.user_id)));
  const codesToday = [...new Set((punches.data ?? []).map((p) => attendanceCode(p.emp_code)))];
  return NextResponse.json({
    hasKey: Boolean(settings.keyHash),
    keyCreatedAt: settings.keyCreatedAt ?? null,
    lastSyncAt: settings.lastSyncAt ?? null,
    lastSyncCount: settings.lastSyncCount ?? 0,
    punchesToday: punches.data?.length ?? 0,
    peopleToday: codesToday.length,
    unlinkedCodes: codesToday.filter((c) => !userIds.has(c)).sort(),
    linkedStaff: codesToday.filter((c) => userIds.has(c)).length,
    tableReady: !punches.error,
    scriptVersion: settings.scriptVersion ?? 0,
    backfillFrom: settings.backfillFrom ?? null,
    backfillAskedAt: settings.backfillAskedAt ?? null,
    backfillDoneAt: settings.backfillDoneAt ?? null,
    backfillDoneFrom: settings.backfillDoneFrom ?? null,
    backfillSent: settings.backfillSent ?? 0,
    devices,
    stores: (storeList?.stores ?? []).map((st) => st.name),
    notInApp: missing.list,
    namesAt: missing.namesAt,
    hiddenCodes: missing.hidden,
  });
}

export async function POST(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { action?: string; from?: string; device?: string; store?: string; code?: string; note?: string };
  if (body.action === "hideCode" || body.action === "showCode") {
    const code = attendanceCode(body.code);
    if (!code || code.length > 20) return NextResponse.json({ error: "Unknown code." }, { status: 400 });
    const hidden = await hiddenCodes();
    if (body.action === "hideCode") hidden[code] = { note: String(body.note ?? "").trim().slice(0, 120), by: auth.staff.fullName, at: new Date().toISOString() };
    else delete hidden[code];
    await supabaseAdmin.from("app_settings").upsert({ key: HIDDEN_KEY, value: hidden, updated_at: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "deviceStore") {
    // Which store a punching machine is in (for store opening / closing).
    const device = String(body.device ?? "").trim();
    if (!device || device.length > 60) return NextResponse.json({ error: "Unknown machine." }, { status: 400 });
    const store = String(body.store ?? "").trim().slice(0, 60);
    await setDeviceStore(device, store || null);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "backfill") {
    // Pull older punches: the office PC sends everything from this day at its next run (every 2 minutes).
    const from = String(body.from ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(from))) return NextResponse.json({ error: "Choose a date." }, { status: 400 });
    if (from > todayISO()) return NextResponse.json({ error: "The date is in the future." }, { status: 400 });
    if (from < todayISO(new Date(Date.now() - 400 * 86400_000))) return NextResponse.json({ error: "Choose a date in the last 13 months." }, { status: 400 });
    await saveAttendanceSettings({ backfillFrom: from, backfillAskedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "backfillCancel") {
    await saveAttendanceSettings({ backfillFrom: null });
    return NextResponse.json({ ok: true });
  }
  if (body.action !== "newKey") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const key = newSyncKey();
  await saveAttendanceSettings({ keyHash: hashKey(key), keyCreatedAt: new Date().toISOString() });
  return NextResponse.json({ key });
}
