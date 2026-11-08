// Publishing customer feedback summaries on sevenyears.in (server only).
// Rule: only an overall rating of 4 or 5 can be shown publicly, only with the customer's consent,
// never for confidential (HR) complaints. Enforced here, on the server.

import { supabaseAdmin } from "@/lib/supabase/server";
import type { FeedbackFormKind } from "@/lib/feedback-forms";
import { cleanCustomerText, overallStars, reviewSummary } from "@/lib/review-summary";

export type PublicationStatus = "pending_review" | "approved" | "rejected" | "published" | "unpublished" | "not_eligible";

export const STATUS_LABELS: Record<PublicationStatus, string> = {
  pending_review: "Pending Review",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
  unpublished: "Unpublished",
  not_eligible: "Not Eligible",
};

export type ReviewRow = {
  id: string;
  kind: FeedbackFormKind;
  confidential: boolean;
  answers: Record<string, string | number> | null;
  comment: string | null;
  resolved: string | null;
  public_consent: boolean | null;
  publication_status: PublicationStatus | null;
};

/** Can this feedback ever appear on the website? Returns the reason when not. */
export function eligibility(r: { confidential: boolean; answers: Record<string, string | number> | null; public_consent?: boolean | null }): { ok: boolean; reason: string } {
  if (r.confidential) return { ok: false, reason: "Confidential (HR) — internal only" };
  const stars = overallStars(r.answers ?? {});
  if (stars === null) return { ok: false, reason: "Overall rating not given" };
  if (stars < 4) return { ok: false, reason: `Overall ${stars}★ — internal only` };
  if (!r.public_consent) return { ok: false, reason: "Customer did not agree to publish" };
  return { ok: true, reason: "" };
}

export function cleanDisplayName(name: unknown) {
  return cleanCustomerText(name, 40).replace(/[^\p{L}\p{M} .'-]/gu, "").replace(/\s+/g, " ").trim();
}

async function audit(feedbackId: string, action: string, from: string | null, to: string | null, by: string, note?: string) {
  const { error } = await supabaseAdmin
    .from("feedback_review_audit")
    .insert({ feedback_id: feedbackId, action, from_status: from, to_status: to, changed_by: by, note: note ?? null });
  if (error) console.error("Review audit error:", error);
}

/**
 * Right after the customer submits: write the summary and, when eligible with consent,
 * publish it straight away (the customer chose auto-publish). Never throws — feedback is already saved.
 */
export async function afterFeedbackSaved(feedbackId: string) {
  try {
    const { data } = await supabaseAdmin
      .from("customer_feedback")
      .select("id, kind, confidential, answers, comment, resolved, public_consent, publication_status")
      .eq("id", feedbackId)
      .maybeSingle();
    if (!data) return;
    const r = data as ReviewRow;
    const summary = reviewSummary(r.kind, r.answers ?? {}, r.comment, r.resolved);
    const ok = eligibility(r).ok;
    const status: PublicationStatus = ok ? "published" : "not_eligible";
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("customer_feedback")
      .update({
        summary,
        summary_generated_at: now,
        publication_status: status,
        published_at: ok ? now : null,
        status_changed_by: "system",
        status_changed_at: now,
      })
      .eq("id", feedbackId);
    if (error) throw error;
    await audit(feedbackId, ok ? "auto_published" : "summary_created", r.publication_status ?? null, status, "system");
  } catch (error) {
    console.error("Feedback summary / publish step failed (feedback itself is saved):", error);
  }
}

export type ReviewAction = "publish" | "unpublish" | "approve" | "reject" | "regenerate";

/** Admin action from the dashboard. Eligibility and consent are re-checked here. */
export async function changeReview(feedbackId: string, action: ReviewAction, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await supabaseAdmin
    .from("customer_feedback")
    .select("id, kind, confidential, answers, comment, resolved, public_consent, publication_status")
    .eq("id", feedbackId)
    .maybeSingle();
  if (!data) return { ok: false, error: "Feedback not found." };
  const r = data as ReviewRow;
  const from = r.publication_status ?? "not_eligible";
  const now = new Date().toISOString();

  if (action === "regenerate") {
    const summary = reviewSummary(r.kind, r.answers ?? {}, r.comment, r.resolved);
    const { error } = await supabaseAdmin.from("customer_feedback").update({ summary, summary_generated_at: now }).eq("id", feedbackId);
    if (error) return { ok: false, error: "Could not save the summary." };
    await audit(feedbackId, "summary_regenerated", from, from, by);
    return { ok: true };
  }

  const elig = eligibility(r);
  if ((action === "publish" || action === "approve") && !elig.ok) return { ok: false, error: `Can't publish: ${elig.reason}.` };

  const to = ({ publish: "published", unpublish: "unpublished", approve: "approved", reject: "rejected" } as const)[action] as PublicationStatus;
  const patch: Record<string, unknown> = { publication_status: to, status_changed_by: by, status_changed_at: now };
  if (to === "published") {
    patch.published_at = now;
    // Make sure there is a summary to show.
    patch.summary = reviewSummary(r.kind, r.answers ?? {}, r.comment, r.resolved);
    patch.summary_generated_at = now;
  }
  const { error } = await supabaseAdmin.from("customer_feedback").update(patch).eq("id", feedbackId);
  if (error) return { ok: false, error: "Could not update the review." };
  await audit(feedbackId, action, from, to, by);
  return { ok: true };
}

export type PublicReview = { id: string; rating: number; summary: string; name: string; store: string | null; date: string; kind: FeedbackFormKind };

const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Published reviews for the website. Filters again on eligibility so nothing slips through. */
export async function publishedReviews(limit = 24): Promise<PublicReview[]> {
  const { data, error } = await supabaseAdmin
    .from("customer_feedback")
    .select("id, kind, confidential, answers, summary, public_consent, display_name, store_name, published_at, rated_at")
    .eq("publication_status", "published")
    .eq("public_consent", true)
    .eq("confidential", false)
    .order("published_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 60));
  if (error) {
    console.error("Published reviews error:", error);
    return [];
  }
  return (data ?? [])
    .filter((r) => eligibility(r as { confidential: boolean; answers: Record<string, string | number> | null; public_consent: boolean }).ok && r.summary)
    .map((r) => ({
      id: String(r.id),
      rating: overallStars((r.answers ?? {}) as Record<string, string | number>) ?? 0,
      summary: String(r.summary),
      name: cleanDisplayName(r.display_name) || "Seven Years customer",
      store: r.store_name && r.store_name !== "CORPORATE OFFICE" ? titleCase(String(r.store_name)) : null,
      date: String(r.published_at ?? r.rated_at ?? "").slice(0, 10),
      kind: r.kind as FeedbackFormKind,
    }));
}
