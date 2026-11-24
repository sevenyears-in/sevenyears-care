import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { approveSop } from "@/lib/store-open-close";
import { logAudit } from "@/lib/audit";
import { setCamCheck } from "@/lib/cctv";

// The Director (or the Super Admin) approves an opening / closing that did not follow the SOP,
// or ({ action: "cam" }) marks the CCTV check: verdict "ok" (the photo shows that person),
// "proxy" (someone else punched for them) or null (undo).
export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  if (auth.staff.role !== "director" && auth.staff.role !== "super_admin")
    return NextResponse.json({ error: "Only the Director can do this." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const day = String(body.day ?? "");
  const store = String(body.store ?? "").toUpperCase();
  const kind = body.kind === "close" ? "close" : body.kind === "open" ? "open" : null;
  const note = String(body.note ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !store || !kind) return NextResponse.json({ error: "Check the day, store and opening/closing." }, { status: 400 });
  if (body.action === "cam") {
    const verdict = body.verdict === "ok" || body.verdict === "proxy" ? body.verdict : null;
    try {
      const ok = await setCamCheck(day, store, kind, verdict, auth.staff.fullName, note);
      if (!ok) return NextResponse.json({ error: "That day was not found." }, { status: 404 });
      await logAudit(auth.staff, "store_open_close", `cam_${kind}`, { day, store }, { verdict, note }).catch(() => undefined);
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error("Camera check error:", error);
      return NextResponse.json({ error: "Could not save. (Has the CCTV database update been run?)" }, { status: 500 });
    }
  }
  if (note.length < 3) return NextResponse.json({ error: "Write a short reason for approving." }, { status: 400 });
  try {
    const ok = await approveSop(day, store, kind, auth.staff.fullName, note);
    if (!ok) return NextResponse.json({ error: "Nothing to approve (already approved, or it followed the SOP)." }, { status: 409 });
    await logAudit(auth.staff, "store_open_close", `approve_${kind}`, { day, store }, { note }).catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("SOP approval error:", error);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
}
