import type { Metadata } from "next";
import { PageShell, cardClass } from "@/components/SiteChrome";
import { FeedbackForm } from "@/components/FeedbackForm";
import { readFeedbackToken } from "@/lib/feedback-token";
import { loadFeedbackSubject, savedFeedback } from "@/lib/feedback";
import { FORM_TITLES, feedbackQuestions } from "@/lib/feedback-forms";
import { STAFF_BEHAVIOUR_CATEGORY } from "@/lib/sla";

export const metadata: Metadata = { title: "Your feedback · Seven Years Care", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ref = readFeedbackToken(decodeURIComponent(token));
  const subject = ref ? await loadFeedbackSubject(ref.kind, ref.id) : null;

  if (!ref || !subject) {
    return (
      <PageShell title="Feedback" intro="This link is not valid or has expired.">
        <div className={cardClass}>
          <p className="text-black/70">Please use the latest link we sent you on WhatsApp, or contact the store.</p>
        </div>
      </PageShell>
    );
  }

  const saved = await savedFeedback(subject);
  const staffBehaviour = subject.title === STAFF_BEHAVIOUR_CATEGORY;
  const questions = feedbackQuestions(subject.kind, staffBehaviour);
  const needsConfirmation = subject.kind === "complaint" && subject.status === "resolved" && !saved?.resolved;
  const canRate =
    !saved?.rated &&
    (subject.kind === "sales" ||
      (subject.kind === "service" && ["resolved", "closed"].includes(String(subject.status))) ||
      (subject.kind === "complaint" && (["resolved", "closed"].includes(String(subject.status)) || Boolean(saved?.resolved))));

  const what =
    subject.kind === "sales"
      ? `Bill ${subject.number}${subject.storeName ? ` · ${subject.storeName}` : ""}`
      : `${subject.kind === "service" ? "Service request" : "Complaint"} ${subject.number}${subject.title ? ` · ${subject.title}` : ""}`;

  return (
    <PageShell
      title={FORM_TITLES[subject.kind]}
      intro={`${subject.customerName ? `Hello ${subject.customerName.split(" ")[0]}, ` : ""}it takes less than a minute. ${what}`}
    >
      <FeedbackForm
        token={token}
        kind={subject.kind}
        questions={questions}
        needsConfirmation={needsConfirmation}
        canRate={canRate}
        alreadyDone={Boolean(saved?.rated) && !needsConfirmation}
      />
    </PageShell>
  );
}
