import { NextResponse } from "next/server";
import { readFeedbackToken } from "@/lib/feedback-token";
import { confirmComplaint, loadFeedbackSubject, submitFeedback } from "@/lib/feedback";

// POST /api/feedback  { token, confirm?: "yes"|"partly"|"no" }  → complaint confirmation
// POST /api/feedback  { token, answers: { … } }                  → ratings

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      confirm?: string;
      answers?: Record<string, unknown>;
    };
    const ref = readFeedbackToken(String(body.token ?? ""));
    if (!ref) return NextResponse.json({ error: "This link is not valid." }, { status: 400 });
    const subject = await loadFeedbackSubject(ref.kind, ref.id);
    if (!subject) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });

    const result =
      body.confirm !== undefined
        ? await confirmComplaint(subject, String(body.confirm))
        : await submitFeedback(subject, body.answers ?? {});
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json({ success: true, message: result.message });
  } catch (error) {
    console.error("Feedback error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
