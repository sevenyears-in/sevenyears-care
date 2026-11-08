// Turns a customer's star ratings and comment into a short first-person review summary.
// Fixed wording only: every sentence comes from the exact star label the customer chose,
// so nothing is exaggerated, invented or left out. The comment is quoted as typed (cleaned).

import { NOT_APPLICABLE, STAR_LABELS, type FeedbackFormKind } from "@/lib/feedback-forms";

type Answers = Record<string, string | number | undefined>;

/** 1–5 → "very poor" … "excellent". Anything else (Not applicable, missing) → null. */
export function starWord(v: unknown): string | null {
  if (v === NOT_APPLICABLE) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? STAR_LABELS[n - 1].toLowerCase() : null;
}

/** Remove markup, control characters and extra spaces from customer text (stored and shown as plain text). */
export function cleanCustomerText(text: unknown, max = 600): string {
  let s = String(text ?? "")
    .replace(/<[^>]*>/g, " ") // HTML tags
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) s = `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
  return s;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

type Part = { subject: string; verb: "was" | "were"; word: string; v: number };

/** "A were x, and B was y." — "while" when far apart, "both" when the same. */
function pair(a: Part | null, b: Part | null): string | null {
  if (a && b) {
    if (a.v === b.v) return `${cap(a.subject)}, and ${b.subject}, were both ${a.word}.`;
    return `${cap(a.subject)} ${a.verb} ${a.word}${Math.abs(a.v - b.v) >= 2 ? ", while " : ", and "}${b.subject} ${b.verb} ${b.word}.`;
  }
  const one = a ?? b;
  return one ? `${cap(one.subject)} ${one.verb} ${one.word}.` : null;
}

function part(answers: Answers, id: string, subject: string, verb: "was" | "were"): Part | null {
  const word = starWord(answers[id]);
  return word ? { subject, verb, word, v: Number(answers[id]) } : null;
}

/** A good overall rating followed only by poor details reads "However, …" so the criticism stays clear. */
function contrast(overall: unknown, parts: (Part | null)[], rest: string | null) {
  const o = Number(overall);
  const got = parts.filter((p): p is Part => !!p);
  if (!rest || !(o >= 4) || !got.length || !got.every((p) => p.v <= 2)) return rest;
  return `However, ${rest[0].toLowerCase()}${rest.slice(1)}`;
}

function commentSentence(comment: string, kind: FeedbackFormKind) {
  const c = cleanCustomerText(comment);
  if (!c) return null;
  const quoted = `“${c.replace(/^["“”']+|["“”']+$/g, "")}”`;
  return kind === "service" ? `I would also like to add: ${quoted}` : `My suggestion for improvement: ${quoted}`;
}

/**
 * The review summary for one feedback.
 * answers = stored answers (question id → 1–5, "na" or a choice); resolved = complaint confirmation.
 */
export function reviewSummary(kind: FeedbackFormKind, answers: Answers, comment: string | null, resolved?: string | null): string {
  const sentences: string[] = [];

  if (kind === "sales") {
    const overall = starWord(answers.overall);
    if (overall) sentences.push(`My shopping experience at Seven Years was ${overall}.`);
    const staff = part(answers, "staff", "the staff's helpfulness and behaviour", "were");
    const explained = part(answers, "explained", "the explanation of products, pricing and warranty", "was");
    let rest = pair(staff, explained);
    if (rest && !overall) rest = `At Seven Years, ${rest[0].toLowerCase()}${rest.slice(1)}`;
    else rest = contrast(answers.overall, [staff, explained], rest);
    if (rest) sentences.push(rest);
  } else if (kind === "service") {
    const overall = starWord(answers.overall);
    if (overall) sentences.push(`My service experience with Seven Years was ${overall}.`);
    const tech = part(answers, "technician", "the technician's professionalism and quality of work", "were");
    const updates = part(answers, "updates", "the scheduling and progress updates", "were");
    let rest = pair(tech, updates);
    if (rest && !overall) rest = `With Seven Years service, ${rest[0].toLowerCase()}${rest.slice(1)}`;
    else rest = contrast(answers.overall, [tech, updates], rest);
    if (rest) sentences.push(rest);
    const working = {
      yes: "My product is now working as expected.",
      partly: "My product is only partly working as expected.",
      no: "My product is not yet working as expected.",
      too_early: "It is too early to tell whether my product is working as expected.",
    }[String(answers.working ?? "")];
    if (working) sentences.push(working);
  } else {
    const overall = starWord(answers.overall);
    if (overall) sentences.push(`The way Seven Years handled my complaint was ${overall}.`);
    const second = answers.respect !== undefined
      ? part(answers, "respect", "the respect and sensitivity shown to me", "were")
      : part(answers, "communication", "the communication and updates", "were");
    const outcome = part(answers, "outcome", "my satisfaction with the outcome", "was");
    let rest = pair(second, outcome);
    if (rest && !overall) rest = `When I raised a complaint with Seven Years, ${rest[0].toLowerCase()}${rest.slice(1)}`;
    else rest = contrast(answers.overall, [second, outcome], rest);
    if (rest) sentences.push(rest);
    const res = { yes: "My complaint was resolved.", partly: "My complaint was only partly resolved.", no: "My complaint was not resolved." }[
      String(resolved ?? "")
    ];
    if (res) sentences.push(res);
  }

  const c = commentSentence(comment ?? "", kind);
  if (c) sentences.push(c);
  if (sentences.length === 0) return "";
  // Every summary mentions Seven Years at least once.
  const text = sentences.join(" ");
  return /seven years/i.test(text) ? text : `About Seven Years: ${text}`;
}

/** Public website: only an overall rating of 4 or 5 qualifies (never an average). */
export function overallStars(answers: Answers): number | null {
  const n = Number(answers.overall);
  return answers.overall !== NOT_APPLICABLE && Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}
