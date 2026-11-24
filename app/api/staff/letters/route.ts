import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createLetter, isLetterKind } from "@/lib/warning-letters";

// POST { staffId, kind, subject, body } → write a warning letter.
// Super Admin / HR / Director: sent at once. Store Manager: waits for HR or a Director.
export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isLetterKind(body.kind)) return NextResponse.json({ error: "Choose the type of warning." }, { status: 400 });
  try {
    const letter = await createLetter(auth.staff, {
      staffId: String(body.staffId ?? ""),
      kind: body.kind,
      subject: String(body.subject ?? ""),
      body: String(body.body ?? ""),
    });
    await logAudit(auth.staff, "warning_letters", "create", { id: letter.id }, { staff: letter.staff_name, status: letter.status, number: letter.number }).catch(() => undefined);
    return NextResponse.json({ ok: true, id: letter.id, status: letter.status, number: letter.number, emailStatus: letter.email_status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the letter.";
    console.error("Warning letter error:", error);
    return NextResponse.json({ error: /relation|does not exist|schema cache/i.test(message) ? "The warning-letter database update has not been run yet." : message }, { status: 400 });
  }
}
