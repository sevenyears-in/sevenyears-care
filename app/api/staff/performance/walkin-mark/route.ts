import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { markEvent, recheckToday, unmarkEvent } from "@/lib/camera-ai";

// Walk-in photos (management): correct the AI and teach it.
// POST { action: "mark", id, verdict: "staff" | "customer", note? } | { action: "unmark", id } | { action: "recheck", store }
const ROLES = ["super_admin", "director", "admin", "operations_manager"];

export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  if (!ROLES.includes(auth.staff.role)) return NextResponse.json({ error: "Only management can correct the camera count." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = Number(body.id);
  try {
    if (body.action === "mark" && Number.isInteger(id) && (body.verdict === "staff" || body.verdict === "customer")) {
      await markEvent(id, body.verdict, String(body.note ?? ""), auth.staff.fullName);
      await logAudit(auth.staff, "camera_ai", "mark", null, { id, verdict: body.verdict, note: body.note ?? null }).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "unmark" && Number.isInteger(id)) {
      await unmarkEvent(id);
      await logAudit(auth.staff, "camera_ai", "unmark", null, { id }).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "recheck" && typeof body.store === "string" && body.store) {
      const n = await recheckToday(body.store.toUpperCase());
      await logAudit(auth.staff, "camera_ai", "recheck", null, { store: body.store, photos: n }).catch(() => undefined);
      return NextResponse.json({ ok: true, photos: n });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: /relation|does not exist|schema cache/i.test(message) ? "The database update for marking photos has not been run yet." : message }, { status: 400 });
  }
}
