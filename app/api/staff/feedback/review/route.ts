import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { hasSection } from "@/lib/access";
import { canManageReviews } from "@/lib/feedback-access";
import { changeReview, type ReviewAction } from "@/lib/reviews";

const ACTIONS: ReviewAction[] = ["publish", "unpublish", "approve", "reject", "regenerate"];

// POST /api/staff/feedback/review  { id, action }  — Super Admin / Admin / Director only.
export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  if (!hasSection(auth.staff, "feedback") || !canManageReviews(auth.staff.role)) {
    return NextResponse.json({ error: "Only the Super Admin, Admin or a Director can change website reviews." }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { id?: string; action?: string };
  const id = String(body.id ?? "");
  const action = String(body.action ?? "") as ReviewAction;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !ACTIONS.includes(action)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const result = await changeReview(id, action, `${auth.staff.fullName} (${auth.staff.userId})`);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true });
}
