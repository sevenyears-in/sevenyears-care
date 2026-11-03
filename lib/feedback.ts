// Customer feedback: what is being rated, saving answers, complaint confirmation (server only).

import { supabaseAdmin } from "@/lib/supabase/server";
import { feedbackLink, type FeedbackKind } from "@/lib/feedback-token";
import {
  COMPLAINT_RESOLVED_QUESTION,
  feedbackQuestions,
  NOT_APPLICABLE,
  type FeedbackFormKind,
} from "@/lib/feedback-forms";
import { complaintKind, STAFF_BEHAVIOUR_CATEGORY } from "@/lib/sla";
import { findDirectors, findRecipients, findStaffByIds, notifyStaff, type Recipient } from "@/lib/notify";
import type { Role } from "@/lib/roles";

export type FeedbackSubject = {
  kind: FeedbackKind;
  id: string;
  number: string; // bill / service request / complaint number
  storeName: string | null;
  customerName: string | null;
  mobile: string | null;
  staffName: string | null;
  confidential: boolean;
  status: string | null;
  title: string | null;
  ownerId: string | null;
};

export type SavedFeedback = {
  id: string;
  resolved: string | null;
  rated: boolean;
};

export async function loadFeedbackSubject(kind: FeedbackKind, id: string): Promise<FeedbackSubject | null> {
  if (kind === "sales") {
    const { data } = await supabaseAdmin
      .from("warranties")
      .select("id, bill_number, store_name, customer_name, customer_mobile, registered_by, staff_users:registered_by ( full_name )")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const staff = data.staff_users as unknown as { full_name: string } | { full_name: string }[] | null;
    const staffName = Array.isArray(staff) ? staff[0]?.full_name ?? null : staff?.full_name ?? null;
    return {
      kind,
      id: data.id,
      number: data.bill_number,
      storeName: data.store_name,
      customerName: data.customer_name,
      mobile: data.customer_mobile,
      staffName,
      confidential: false,
      status: null,
      title: "Your purchase",
      ownerId: null,
    };
  }
  if (kind === "service") {
    const { data } = await supabaseAdmin
      .from("service_requests")
      .select("id, request_number, store_name, contact_name, contact_mobile, status, issue_type, assigned_technician_id, product_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    let staffName: string | null = null;
    if (data.assigned_technician_id) {
      const [tech] = await findStaffByIds([data.assigned_technician_id]);
      staffName = tech?.full_name ?? null;
    }
    return {
      kind,
      id: data.id,
      number: data.request_number,
      storeName: data.store_name,
      customerName: data.contact_name,
      mobile: data.contact_mobile,
      staffName,
      confidential: false,
      status: data.status,
      title: data.product_name ? `${data.product_name} — ${data.issue_type}` : data.issue_type,
      ownerId: data.assigned_technician_id,
    };
  }
  const { data } = await supabaseAdmin
    .from("complaints")
    .select("id, complaint_number, store_name, contact_name, contact_mobile, status, category, owner_id, involved_staff_name")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    kind,
    id: data.id,
    number: data.complaint_number,
    storeName: data.store_name,
    customerName: data.contact_name,
    mobile: data.contact_mobile,
    staffName: data.involved_staff_name,
    confidential: complaintKind(data.category) === "staff",
    status: data.status,
    title: data.category,
    ownerId: data.owner_id,
  };
}

/** Feedback already given for this subject (sales: for the same bill). */
export async function savedFeedback(subject: FeedbackSubject): Promise<SavedFeedback | null> {
  let query = supabaseAdmin.from("customer_feedback").select("id, resolved, overall, answers").eq("kind", subject.kind);
  query = subject.kind === "sales" ? query.eq("ref_number", subject.number) : query.eq("ref_id", subject.id);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) {
    // Table not created yet, etc. — treat as "no feedback".
    if (!String(error.message).includes("multiple")) console.error("customer_feedback read error:", error.message);
    return null;
  }
  if (!data) return null;
  const answers = (data.answers ?? {}) as Record<string, unknown>;
  return { id: data.id, resolved: data.resolved, rated: Object.keys(answers).length > 0 };
}

/** Feedback link to show the customer, or null once everything has been answered. */
export async function pendingFeedbackLink(kind: FeedbackKind, id: string, status?: string | null) {
  if (kind === "service" && !["resolved", "closed"].includes(String(status))) return null;
  if (kind === "complaint" && !["resolved", "closed"].includes(String(status))) return null;
  const subject = await loadFeedbackSubject(kind, id);
  if (!subject) return null;
  const saved = await savedFeedback(subject);
  if (kind === "complaint" && subject.status === "resolved" && !saved?.resolved) return feedbackLink(kind, id);
  if (saved?.rated) return null;
  return feedbackLink(kind, id);
}

function clean(subject: FeedbackSubject, raw: Record<string, unknown>) {
  const questions = feedbackQuestions(subject.kind as FeedbackFormKind, subject.title === STAFF_BEHAVIOUR_CATEGORY);
  const answers: Record<string, string | number> = {};
  let comment = "";
  for (const q of questions) {
    const v = raw[q.id];
    if (q.type === "stars") {
      if (v === NOT_APPLICABLE) answers[q.id] = NOT_APPLICABLE;
      else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 5) return { error: `Please answer: ${q.label}` };
        answers[q.id] = n;
      }
    } else if (q.type === "choice") {
      const s = String(v ?? "");
      if (!q.options.some((o) => o.value === s)) return { error: `Please answer: ${q.label}` };
      answers[q.id] = s;
    } else {
      comment = String(v ?? "").trim().slice(0, 2000);
    }
  }
  const stars = Object.values(answers).filter((v): v is number => typeof v === "number");
  const overall = stars.length ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10 : null;
  return { answers, comment, overall, lowest: stars.length ? Math.min(...stars) : null };
}

/** Who hears about feedback that needs a follow-up. */
async function followUpPeople(subject: FeedbackSubject): Promise<Recipient[]> {
  let roles: Role[];
  if (subject.confidential) roles = ["hr_head", "hr_executive"];
  else if (subject.kind === "service") roles = ["store_manager", "service_head"];
  else if (subject.kind === "sales") roles = ["store_manager", "cre"];
  else roles = ["store_manager"];
  return [
    ...(await findRecipients(roles, subject.storeName)),
    ...(subject.ownerId && subject.kind === "complaint" ? await findStaffByIds([subject.ownerId]) : []),
  ];
}

async function alertFollowUp(subject: FeedbackSubject, title: string, summary: string) {
  const people = await followUpPeople(subject);
  if (subject.kind === "sales") {
    // Sales feedback is not a ticket: dashboard alert only (no ticket link).
    if (people.length === 0) return;
    await supabaseAdmin.from("staff_notifications").insert(
      [...new Map(people.map((p) => [p.id, p])).values()].map((p) => ({
        staff_id: p.id,
        ticket_type: null,
        ticket_id: null,
        ticket_number: subject.number,
        title: `${title} · ${subject.number}`,
        body: summary,
      }))
    );
    return;
  }
  await notifyStaff(people, {
    ticketType: subject.kind,
    ticketId: subject.id,
    ticketNumber: subject.number,
    title,
    summary,
    details: subject.storeName ? [`Store: ${subject.storeName}`] : [],
    storeName: subject.storeName,
  });
}

export type SubmitResult = { ok: true; message: string } | { ok: false; error: string; status?: number };

/** Ratings form. */
export async function submitFeedback(subject: FeedbackSubject, raw: Record<string, unknown>): Promise<SubmitResult> {
  const saved = await savedFeedback(subject);
  if (saved?.rated) return { ok: false, error: "You have already shared your feedback. Thank you!", status: 409 };
  if (subject.kind === "service" && !["resolved", "closed"].includes(String(subject.status))) {
    return { ok: false, error: "You can rate the service once the work is completed.", status: 409 };
  }
  if (subject.kind === "complaint" && !["resolved", "closed"].includes(String(subject.status)) && !saved?.resolved) {
    return { ok: false, error: "You can rate us once your complaint has been resolved.", status: 409 };
  }

  const result = clean(subject, raw);
  if ("error" in result) return { ok: false, error: result.error ?? "Please answer all questions.", status: 400 };

  const working = String(result.answers.working ?? "");
  const reasons: string[] = [];
  if (result.lowest !== null && result.lowest <= 2) reasons.push(`low rating (${result.lowest}/5)`);
  if (subject.kind === "service" && ["partly", "no"].includes(working)) {
    reasons.push(`product working: ${working === "no" ? "No" : "Partly"}`);
  }
  if (subject.kind === "complaint" && saved?.resolved && saved.resolved !== "yes") reasons.push(`resolved: ${saved.resolved}`);
  const needsFollowup = reasons.length > 0;

  const row = {
    kind: subject.kind,
    ref_id: subject.id,
    ref_number: subject.number,
    mobile: subject.mobile,
    store_name: subject.storeName,
    staff_name: subject.staffName,
    confidential: subject.confidential,
    answers: result.answers,
    overall: result.overall,
    comment: result.comment || null,
    needs_followup: needsFollowup,
    rated_at: new Date().toISOString(),
  };

  const { error } = saved
    ? await supabaseAdmin
        .from("customer_feedback")
        .update({ ...row, needs_followup: needsFollowup || undefined })
        .eq("id", saved.id)
    : await supabaseAdmin.from("customer_feedback").insert(row);
  if (error) {
    console.error("Save feedback error:", error);
    return { ok: false, error: "Unable to save your feedback. Please try again.", status: 500 };
  }

  if (needsFollowup) {
    const label = { sales: "Sales", service: "Service", complaint: "Complaint handling" }[subject.kind];
    await alertFollowUp(
      subject,
      `Follow up: ${label} feedback`,
      `${subject.customerName ?? "Customer"}${subject.confidential ? "" : ` (${subject.mobile})`} — ${reasons.join(", ")}${
        result.comment ? ` · "${result.comment.slice(0, 200)}"` : ""
      }`
    ).catch((e) => console.error("Feedback follow-up alert failed:", e));
  }

  return {
    ok: true,
    message: needsFollowup
      ? "Thank you. We are sorry it wasn't better — our team will contact you."
      : "Thank you for your feedback!",
  };
}

/** Complaint confirmation: Yes → closed; Partly / No → reopened and the owner + Store Manager told. */
export async function confirmComplaint(subject: FeedbackSubject, answer: string): Promise<SubmitResult> {
  if (subject.kind !== "complaint") return { ok: false, error: "Not a complaint.", status: 400 };
  if (!COMPLAINT_RESOLVED_QUESTION.options.some((o) => o.value === answer)) {
    return { ok: false, error: "Please choose Yes, Partly or No.", status: 400 };
  }
  if (subject.status !== "resolved") {
    return { ok: false, error: "This complaint is no longer waiting for your confirmation.", status: 409 };
  }

  const now = new Date().toISOString();
  const update =
    answer === "yes"
      ? { status: "closed", closed_at: now }
      : { status: "in_progress", resolved_at: null, closed_at: null };
  const { data: changed, error } = await supabaseAdmin
    .from("complaints")
    .update(update)
    .eq("id", subject.id)
    .eq("status", "resolved")
    .select("id");
  if (error) {
    console.error("Confirm complaint error:", error);
    return { ok: false, error: "Unable to save. Please try again.", status: 500 };
  }
  if (!changed?.length) return { ok: false, error: "This complaint was just updated. Refresh the page.", status: 409 };

  const customerNote =
    answer === "yes"
      ? "You confirmed the complaint is resolved. Closed — thank you!"
      : answer === "partly"
        ? "You told us the complaint is only partly resolved. We have reopened it and will contact you."
        : "You told us the complaint is not resolved. We have reopened it and will contact you.";

  await supabaseAdmin.from("ticket_status_history").insert({
    ticket_type: "complaint",
    ticket_id: subject.id,
    status: update.status,
    note: customerNote,
    visibility: "customer",
    action: answer === "yes" ? "close" : "reopen",
    actor_id: null,
    actor_name: "Customer",
  });

  const saved = await savedFeedback(subject);
  const base = {
    kind: "complaint",
    ref_id: subject.id,
    ref_number: subject.number,
    mobile: subject.mobile,
    store_name: subject.storeName,
    staff_name: subject.staffName,
    confidential: subject.confidential,
    resolved: answer,
    needs_followup: answer !== "yes",
  };
  const { error: fbError } = saved
    ? await supabaseAdmin.from("customer_feedback").update({ resolved: answer, needs_followup: answer !== "yes" }).eq("id", saved.id)
    : await supabaseAdmin.from("customer_feedback").insert({ ...base, answers: {} });
  if (fbError) console.error("Save confirmation error:", fbError);

  if (answer !== "yes") {
    const people = [
      ...(await followUpPeople(subject)),
      ...(subject.confidential ? [] : await findDirectors(subject.storeName)),
    ];
    await notifyStaff(people, {
      ticketType: "complaint",
      ticketId: subject.id,
      ticketNumber: subject.number,
      title: answer === "no" ? "Customer says: NOT resolved — reopened" : "Customer says: partly resolved — reopened",
      summary: `${subject.title ?? "Complaint"} · ${subject.customerName ?? "Customer"}`,
      details: subject.storeName ? [`Store: ${subject.storeName}`] : [],
      storeName: subject.storeName,
    }).catch((e) => console.error("Reopen alert failed:", e));
  }

  return { ok: true, message: customerNote };
}
