// Shared helpers used by both API routes and pages.

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
  const year = new Date().getFullYear();
  const random = Math.floor(100000 + Math.random() * 900000);
  return `SY-${prefix}-${year}-${random}`;
}

/** Format a YYYY-MM-DD or ISO date as "26 Oct 2026". */
export function formatDate(value?: string | null) {
  if (!value) return "—";

  let date: Date;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    date = new Date(year, month - 1, day);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
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
  }).format(date);
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayISO() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
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
