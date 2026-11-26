import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { addLink, cctvRequests, linkStatuses, loadCctv, removeLink, setCamWatch, setLinkChannels, WATCH_LIMITS, type CamWatch } from "@/lib/cctv";
import { logAudit } from "@/lib/audit";
import { openCloseStores } from "@/lib/store-open-close";

// Settings → Attendance → CCTV (Super Admin): one link per store NVR.
// GET → links with their status; POST { action: "add", store } | { action: "remove", id } | { action: "channels", id, channels } | { action: "watch", watch }

export async function GET() {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const [links, stores, requests, saved] = await Promise.all([linkStatuses(), openCloseStores(), cctvRequests().catch(() => []), loadCctv(true)]);
  return NextResponse.json({ links, stores, requests, watch: saved.watch, limits: WATCH_LIMITS });
}

export async function POST(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { action?: string; store?: string; id?: string; channels?: unknown[]; watch?: Partial<CamWatch> };
  if (body.action === "watch") {
    const w = body.watch ?? {};
    for (const [k, [lo, hi]] of Object.entries(WATCH_LIMITS)) {
      const n = Number((w as Record<string, unknown>)[k]);
      if (!Number.isFinite(n) || n < lo || n > hi) return NextResponse.json({ error: `${k === "groupSec" ? "The seconds" : k === "walkinCode" ? "The recorder code" : "Each number of minutes"} must be between ${lo} and ${hi}.` }, { status: 400 });
    }
    const before = (await loadCctv(true)).watch;
    await setCamWatch({ ...before, ...w } as CamWatch);
    await logAudit(auth.staff, "cctv", "watch", before, w);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "add") {
    const store = String(body.store ?? "").trim().toUpperCase();
    if (!store) return NextResponse.json({ error: "Choose a store." }, { status: 400 });
    const link = await addLink(store, auth.staff.userId);
    await logAudit(auth.staff, "cctv", "add_link", null, { id: link.id, store });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "remove" && body.id) {
    await removeLink(String(body.id));
    await logAudit(auth.staff, "cctv", "remove_link", { id: body.id }, null);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "channels" && body.id) {
    await setLinkChannels(String(body.id), Array.isArray(body.channels) ? body.channels.map(Number) : []);
    await logAudit(auth.staff, "cctv", "channels", null, { id: body.id, channels: body.channels });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
