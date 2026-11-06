import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { canSeeFeedback, feedbackScope } from "@/lib/feedback-access";
import { sameStore } from "@/lib/roles";
import { hasSection } from "@/lib/access";

// POST /api/staff/feedback  { id, note? }  → mark a feedback follow-up as done.

export async function POST(request: Request) {
  const auth = await requireStaff("staff");
  if (auth.response) return auth.response;
  const staff = auth.staff;
  if (!hasSection(staff, "feedback")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const scope = feedbackScope(staff);
  if (!scope.canMarkDone) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { id?: string; note?: string };
  const { data: row } = await supabaseAdmin
    .from("customer_feedback")
    .select("id, store_name, confidential")
    .eq("id", String(body.id ?? ""))
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (row.confidential && !scope.confidential) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  if (!scope.allStores && !sameStore(row.store_name, staff.storeName)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from("customer_feedback")
    .update({
      followup_done_at: new Date().toISOString(),
      followup_by: staff.fullName,
      followup_note: String(body.note ?? "").trim().slice(0, 1000) || null,
    })
    .eq("id", row.id);
  if (error) {
    console.error("Feedback follow-up error:", error);
    return NextResponse.json({ error: "Unable to save." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
