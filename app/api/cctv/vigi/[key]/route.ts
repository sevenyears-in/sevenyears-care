import { NextResponse } from "next/server";
import { linkByKey, saveEvents } from "@/lib/cctv";

// TP-Link VIGI NVR → Alarm Server (Settings → Event → Alarm Server on the NVR).
// URL path: /api/cctv/vigi/<link key from Settings → Attendance → CCTV>.
// Body: JSON { device_id, device_name, messages: [...] }, or multipart/form-data with the JSON
// in "event" and a JPEG in "snapshot". The NVR expects 200 OK.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

async function readBody(request: Request): Promise<{ body: unknown; photo: Blob | null }> {
  const type = request.headers.get("content-type") ?? "";
  if (/multipart\/form-data/i.test(type)) {
    const form = await request.formData();
    const ev = form.get("event");
    const text = typeof ev === "string" ? ev : ev instanceof Blob ? await ev.text() : "";
    const snap = form.get("snapshot") ?? [...form.values()].find((v) => v instanceof Blob && v !== ev) ?? null;
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { unreadable: text.slice(0, 2000) };
    }
    return { body, photo: snap instanceof Blob ? snap : null };
  }
  const text = await request.text();
  try {
    return { body: text ? JSON.parse(text) : {}, photo: null };
  } catch {
    return { body: { unreadable: text.slice(0, 2000) }, photo: null };
  }
}

export async function POST(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const link = await linkByKey(key);
  if (!link) return NextResponse.json({ error: "Unknown link." }, { status: 404 });
  try {
    const { body, photo } = await readBody(request);
    const saved = await saveEvents(link, body, photo);
    return NextResponse.json({ ok: true, saved });
  } catch (e) {
    console.error("CCTV event not saved:", e);
    // 200 anyway: the NVR would otherwise keep retrying the same event.
    return NextResponse.json({ ok: false });
  }
}

/** The NVR's "Test" button (and a quick check in a browser). */
export async function GET(_request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const link = await linkByKey(key);
  if (!link) return NextResponse.json({ error: "Unknown link." }, { status: 404 });
  return NextResponse.json({ ok: true, store: link.store });
}

export const PUT = POST;
