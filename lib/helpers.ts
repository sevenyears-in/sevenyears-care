// Shared helpers used by both API routes and pages.
// All dates and times are shown in Indian Standard Time (Asia/Kolkata),
// whatever time zone the server or the visitor's device is set to.

export const TIME_ZONE = "Asia/Kolkata";

/** Strip everything except digits from a mobile number. */
export function cleanMobile(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

/** Valid 10-digit Indian mobile number (starts with 6–9). */
export function isValidMobile(mobile: string) {
  return /^[6-9]\d{9}$/.test(mobile);
}

/** Supabase joins can come back as an object or a one-item array. */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Ticket numbers like SY-SRV-2026-482913 or SY-CMP-2026-104822. */
export function generateTicketNumber(prefix: "SRV" | "CMP") {
  const year = todayISO().slice(0, 4);
  const random = Math.floor(100000 + Math.random() * 900000);
  return `SY-${prefix}-${year}-${random}`;
}

/** Format a YYYY-MM-DD or ISO date as "26 Oct 2026". */
export function formatDate(value?: string | null) {
  if (!value) return "—";

  // A plain calendar date (YYYY-MM-DD) is shown as-is; a timestamp is shown in IST.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(date);
}

/** Format an ISO timestamp as "26 Oct 2026, 3:45 pm". */
export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TIME_ZONE,
  }).format(date);
}

/** A moment as YYYY-MM-DD in IST (default: now). */
export function todayISO(at: Date = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Turn a database status like "in_progress" into "In Progress". */
export function statusLabel(status?: string | null) {
  if (!status) return "—";
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Add months to a YYYY-MM-DD date (clamps to month end, e.g. 31 Jan + 1 = 28/29 Feb). */
export function addMonths(isoDate: string, months: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** True for a real calendar date in YYYY-MM-DD form. */
export function isISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
