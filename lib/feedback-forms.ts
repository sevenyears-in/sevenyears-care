// The three customer feedback forms (shared by server and browser code).

export type FeedbackFormKind = "sales" | "service" | "complaint";

export type FeedbackQuestion =
  | { id: string; type: "stars"; label: string }
  | { id: string; type: "choice"; label: string; options: { value: string; label: string }[] }
  | { id: string; type: "comment"; label: string };

export const STAR_LABELS = ["Very poor", "Poor", "Average", "Good", "Excellent"];
export const NOT_APPLICABLE = "na";

export const FORM_TITLES: Record<FeedbackFormKind, string> = {
  sales: "Sales feedback",
  service: "Service feedback",
  complaint: "Complaint handling feedback",
};

const YES_PARTLY_NO = [
  { value: "yes", label: "Yes" },
  { value: "partly", label: "Partly" },
  { value: "no", label: "No" },
];

export const COMPLAINT_RESOLVED_QUESTION = {
  id: "resolved",
  type: "choice" as const,
  label: "Has your complaint been resolved?",
  options: YES_PARTLY_NO,
};

export function feedbackQuestions(kind: FeedbackFormKind, staffBehaviour = false): FeedbackQuestion[] {
  if (kind === "sales") {
    return [
      { id: "overall", type: "stars", label: "How would you rate your overall shopping experience?" },
      { id: "staff", type: "stars", label: "How would you rate the staff's helpfulness and behaviour?" },
      { id: "explained", type: "stars", label: "How clearly were the product, price and warranty explained?" },
      { id: "comment", type: "comment", label: "What could we improve?" },
    ];
  }
  if (kind === "service") {
    return [
      { id: "overall", type: "stars", label: "Overall service experience" },
      { id: "technician", type: "stars", label: "Technician's professionalism and quality of work" },
      { id: "updates", type: "stars", label: "Scheduling and progress updates" },
      {
        id: "working",
        type: "choice",
        label: "Is your product working as expected now?",
        options: [...YES_PARTLY_NO, { value: "too_early", label: "Too early to tell" }],
      },
      { id: "comment", type: "comment", label: "Anything else you would like us to know?" },
    ];
  }
  // Complaint handling — "Has it been resolved?" is asked separately (confirmation step).
  return [
    { id: "overall", type: "stars", label: "How would you rate the way we handled your complaint?" },
    staffBehaviour
      ? { id: "respect", type: "stars", label: "How respectfully and sensitively was your complaint handled?" }
      : { id: "communication", type: "stars", label: "Communication and updates" },
    { id: "outcome", type: "stars", label: "Satisfaction with the outcome" },
    { id: "comment", type: "comment", label: "What could we have done better?" },
  ];
}

/** Short label for a stored answer (reports). */
export function answerLabel(value: unknown) {
  if (value === NOT_APPLICABLE) return "Not applicable";
  if (typeof value === "number") return `${value} · ${STAR_LABELS[value - 1] ?? ""}`;
  const v = String(value ?? "");
  return { yes: "Yes", partly: "Partly", no: "No", too_early: "Too early to tell" }[v] ?? v;
}
