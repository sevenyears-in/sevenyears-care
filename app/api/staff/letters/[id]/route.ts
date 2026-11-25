import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { acknowledgeLetter, approveLetter, canSeeLetter, getLetter, rejectLetter, revokeLetter, withdrawLetter } from "@/lib/warning-letters";

// POST { action: "approve", subject?, body? } | { action: "reject", reason } | { action: "withdraw" } | { action: "revoke", reason } | { action: "ack", note? }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const { id } = await params;
  const letter = await getLetter(id);
  if (!letter || !canSeeLetter(auth.staff, letter)) return NextResponse.json({ error: "Letter not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.action === "approve") {
      const sent = await approveLetter(auth.staff, letter, { subject: String(body.subject ?? ""), body: String(body.body ?? "") });
      await logAudit(auth.staff, "warning_letters", "approve", { id }, { number: sent.number }).catch(() => undefined);
      return NextResponse.json({ ok: true, number: sent.number });
    }
    if (body.action === "reject") {
      await rejectLetter(auth.staff, letter, String(body.reason ?? ""));
      await logAudit(auth.staff, "warning_letters", "reject", { id }, { reason: body.reason }).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "withdraw") {
      await withdrawLetter(auth.staff, letter);
      await logAudit(auth.staff, "warning_letters", "withdraw", { id }, {}).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "revoke") {
      await revokeLetter(auth.staff, letter, String(body.reason ?? ""));
      await logAudit(auth.staff, "warning_letters", "revoke", { id }, { number: letter.number, reason: body.reason }).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "ack") {
      await acknowledgeLetter(auth.staff, letter, String(body.note ?? ""));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    console.error("Warning letter action error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save." }, { status: 400 });
  }
}
