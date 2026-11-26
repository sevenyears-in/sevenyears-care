// Kinds of letters and their document names (safe to use in the browser too).

export const LETTER_KINDS = {
  sop: "SOP violation (store opening / closing)",
  performance: "Sales performance",
  attendance: "Attendance / punctuality",
  conduct: "Conduct / behaviour",
  other: "Other",
  // Issued by the automatic rules (Warning letters → Automatic letters).
  reminder: "Reminder (late coming)",
  pip: "Performance Improvement Plan",
  second: "Second warning (performance)",
  final: "Final warning (performance)",
  termination: "Termination",
} as const;
export type LetterKind = keyof typeof LETTER_KINDS;
export const isLetterKind = (k: unknown): k is LetterKind => typeof k === "string" && k in LETTER_KINDS;

/** The kinds a person chooses from when writing a letter by hand. */
export const MANUAL_KINDS: Partial<Record<LetterKind, string>> = {
  sop: LETTER_KINDS.sop,
  performance: LETTER_KINDS.performance,
  attendance: LETTER_KINDS.attendance,
  conduct: LETTER_KINDS.conduct,
  other: LETTER_KINDS.other,
};

/** Heading printed on the letter. */
export const LETTER_TITLE: Record<LetterKind, string> = {
  sop: "WARNING LETTER",
  performance: "WARNING LETTER",
  attendance: "WARNING LETTER",
  conduct: "WARNING LETTER",
  other: "WARNING LETTER",
  reminder: "REMINDER",
  pip: "PERFORMANCE IMPROVEMENT PLAN",
  second: "SECOND WARNING LETTER",
  final: "FINAL WARNING LETTER",
  termination: "TERMINATION LETTER",
};

/** Name of the document in alerts and e-mails ("Warning letter SY/WL/2026/004"). */
export const LETTER_DOC: Record<LetterKind, string> = {
  sop: "Warning letter",
  performance: "Warning letter",
  attendance: "Warning letter",
  conduct: "Warning letter",
  other: "Warning letter",
  reminder: "Reminder",
  pip: "Performance Improvement Plan",
  second: "Second warning letter",
  final: "Final warning letter",
  termination: "Termination letter",
};

/** Number series of each kind: SY/WL/2026/001 (warnings), SY/RM/… (reminders), SY/PIP/…, SY/TL/… */
export const LETTER_SERIES: Record<LetterKind, string> = {
  sop: "WL",
  performance: "WL",
  attendance: "WL",
  conduct: "WL",
  other: "WL",
  reminder: "RM",
  pip: "PIP",
  second: "WL",
  final: "WL",
  termination: "TL",
};

export const docName = (kind: string) => LETTER_DOC[kind as LetterKind] ?? "Warning letter";
export const letterTitle = (kind: string) => LETTER_TITLE[kind as LetterKind] ?? "WARNING LETTER";

/** Alerts about letters (they open the letter). */
export const LETTER_ALERT = /^(Warning letter|Reminder|Performance Improvement Plan|Second warning letter|Final warning letter|Termination letter|Letter to confirm|Automatic letter)/;
