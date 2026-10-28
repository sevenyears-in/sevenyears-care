// Alerts to staff (dashboard bell + e-mail + WhatsApp) and updates to customers.
// Server only. Sending never throws: a failed e-mail or WhatsApp message is
// written to notification_log and the request carries on.
//
// Settings (.env.local on your computer / Environment variables on Hostinger):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM          → e-mail
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID                       → WhatsApp (Meta Cloud API)
//   WHATSAPP_STAFF_TEMPLATE     (default: staff_ticket_alert)      → 4 variables
//   WHATSAPP_CUSTOMER_TEMPLATE  (default: customer_ticket_update)  → 4 variables
//   WHATSAPP_TEMPLATE_LANGUAGE  (default: en)
// See NOTIFICATIONS-SETUP.md.

import { sendSmtpMail } from "@/lib/smtp";
import { supabaseAdmin } from "@/lib/supabase/server";
import { asRole, type Role, sameStore, STORE_SCOPED_ROLES } from "@/lib/roles";
import type { TicketType } from "@/lib/sla";

export function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  return configured && /^https?:\/\//.test(configured) ? configured : "https://care.sevenyears.in";
}

export function staffTicketLink(type: TicketType, id: string) {
  return `${siteUrl()}/staff/${type === "service" ? "service" : "complaints"}/${id}`;
}

export function customerTrackLink(ticketNumber: string) {
  return `${siteUrl()}/track-request?ticket=${encodeURIComponent(ticketNumber)}`;
}

// ------------------------------------------------------------------
// Configuration status
// ------------------------------------------------------------------

export function emailSettings() {
  return {
    host: process.env.SMTP_HOST?.trim() ?? "",
    port: Number(process.env.SMTP_PORT ?? 465),
    user: process.env.SMTP_USER?.trim() ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.MAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || "",
  };
}

export function emailConfigured() {
  const s = emailSettings();
  return Boolean(s.host && s.user && s.pass && s.from);
}

export function whatsappSettings() {
  return {
    token: process.env.WHATSAPP_TOKEN?.trim() ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "",
    staffTemplate: process.env.WHATSAPP_STAFF_TEMPLATE?.trim() || "staff_ticket_alert",
    customerTemplate: process.env.WHATSAPP_CUSTOMER_TEMPLATE?.trim() || "customer_ticket_update",
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en",
  };
}

export function whatsappConfigured() {
  const s = whatsappSettings();
  return Boolean(s.token && s.phoneNumberId);
}

// ------------------------------------------------------------------
// Low-level senders
// ------------------------------------------------------------------

type LogMeta = { audience: "staff" | "customer"; ticketNumber?: string | null };

async function log(
  channel: "email" | "whatsapp",
  recipient: string,
  status: "sent" | "failed" | "skipped",
  meta: LogMeta & { subject?: string; error?: string }
) {
  try {
    await supabaseAdmin.from("notification_log").insert({
      channel,
      recipient,
      audience: meta.audience,
      ticket_number: meta.ticketNumber ?? null,
      subject: meta.subject?.slice(0, 300) ?? null,
      status,
      error: meta.error?.slice(0, 1000) ?? null,
    });
  } catch (error) {
    console.error("notification_log insert failed:", error);
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  meta: LogMeta
): Promise<{ ok: boolean; error?: string }> {
  if (!to) return { ok: false, error: "No e-mail address" };
  if (!emailConfigured()) {
    await log("email", to, "skipped", { ...meta, subject, error: "E-mail is not set up" });
    return { ok: false, error: "E-mail is not set up (SMTP settings missing)." };
  }

  try {
    const s = emailSettings();
    await sendSmtpMail(
      { host: s.host, port: s.port, user: s.user, pass: s.pass },
      { from: s.from, fromName: "Seven Years Care", to, subject, text, html: textToHtml(text) }
    );
    await log("email", to, "sent", { ...meta, subject });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("E-mail failed:", message);
    await log("email", to, "failed", { ...meta, subject, error: message });
    return { ok: false, error: message };
  }
}

function textToHtml(text: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br>");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#161616">${escaped}</div>`;
}

/** WhatsApp template variables cannot contain new lines, tabs or 4+ spaces. */
function cleanParam(value: string) {
  return (value || "-").replace(/[\n\r\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 900) || "-";
}

export async function sendWhatsApp(
  mobile10: string,
  template: string,
  params: string[],
  meta: LogMeta
): Promise<{ ok: boolean; error?: string }> {
  const digits = String(mobile10 ?? "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(digits)) return { ok: false, error: "No valid WhatsApp number" };
  const to = `91${digits}`;

  if (!whatsappConfigured()) {
    await log("whatsapp", to, "skipped", { ...meta, subject: template, error: "WhatsApp is not set up" });
    return { ok: false, error: "WhatsApp is not set up (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID missing)." };
  }

  const s = whatsappSettings();
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${s.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: template,
          language: { code: s.language },
          components: [
            {
              type: "body",
              parameters: params.map((text) => ({ type: "text", text: cleanParam(text) })),
            },
          ],
        },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      const message = body.error?.message ?? `HTTP ${response.status}`;
      await log("whatsapp", to, "failed", { ...meta, subject: template, error: message });
      return { ok: false, error: message };
    }

    await log("whatsapp", to, "sent", { ...meta, subject: template });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log("whatsapp", to, "failed", { ...meta, subject: template, error: message });
    return { ok: false, error: message };
  }
}

// ------------------------------------------------------------------
// Who gets told about a ticket
// ------------------------------------------------------------------

export type Recipient = {
  id: string;
  full_name: string;
  role: Role;
  store_name: string | null;
  email: string | null;
  whatsapp_number: string | null;
  notify_email: boolean;
  notify_whatsapp: boolean;
};

const RECIPIENT_COLUMNS =
  "id, full_name, role, store_name, email, whatsapp_number, notify_email, notify_whatsapp";

/**
 * Service request → Store Manager + Technicians of that store, Service Head.
 * Complaint       → Store Manager of that store, HR Head, Operations Manager.
 * Store-based roles only get tickets of their own store.
 */
export const ROUTING: Record<TicketType, Role[]> = {
  service: ["store_manager", "technician", "service_head"],
  complaint: ["store_manager", "hr_head", "operations_manager"],
};

export async function findRecipients(roles: Role[], storeName: string | null): Promise<Recipient[]> {
  if (roles.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("staff_users")
    .select(RECIPIENT_COLUMNS)
    .eq("is_active", true)
    .in("role", roles);

  if (error) {
    console.error("Recipient lookup failed:", error);
    return [];
  }

  return (data ?? [])
    .map((row) => ({ ...row, role: asRole(row.role) }) as Recipient)
    .filter((row) => !STORE_SCOPED_ROLES.includes(row.role) || sameStore(row.store_name, storeName));
}

export async function findStaffByIds(ids: (string | null | undefined)[]): Promise<Recipient[]> {
  const clean = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (clean.length === 0) return [];
  const { data } = await supabaseAdmin
    .from("staff_users")
    .select(RECIPIENT_COLUMNS)
    .eq("is_active", true)
    .in("id", clean);
  return (data ?? []).map((row) => ({ ...row, role: asRole(row.role) }) as Recipient);
}

export type StaffAlert = {
  ticketType: TicketType;
  ticketId: string;
  ticketNumber: string;
  /** Short headline, e.g. "New service request" */
  title: string;
  /** One-line summary for WhatsApp, e.g. "Stroller — Wheel, brake or frame issue · Customer: Anu" */
  summary: string;
  /** Extra lines for the e-mail and dashboard alert. */
  details?: string[];
  storeName: string | null;
};

/** Dashboard alert + e-mail + WhatsApp to each staff member (once each). */
export async function notifyStaff(recipients: Recipient[], alert: StaffAlert, exceptStaffId?: string) {
  const unique = new Map<string, Recipient>();
  for (const r of recipients) if (r.id !== exceptStaffId) unique.set(r.id, r);
  const list = [...unique.values()];
  if (list.length === 0) return;

  const link = staffTicketLink(alert.ticketType, alert.ticketId);
  const body = [alert.summary, ...(alert.details ?? [])].filter(Boolean).join("\n");

  try {
    await supabaseAdmin.from("staff_notifications").insert(
      list.map((r) => ({
        staff_id: r.id,
        ticket_type: alert.ticketType,
        ticket_id: alert.ticketId,
        ticket_number: alert.ticketNumber,
        title: `${alert.title} · ${alert.ticketNumber}`,
        body,
      }))
    );
  } catch (error) {
    console.error("staff_notifications insert failed:", error);
  }

  const meta = { audience: "staff" as const, ticketNumber: alert.ticketNumber };
  const subject = `${alert.title} — ${alert.ticketNumber}`;
  const wa = whatsappSettings();

  await Promise.all(
    list.map(async (r) => {
      const jobs: Promise<unknown>[] = [];
      if (r.notify_email && r.email) {
        jobs.push(
          sendEmail(
            r.email,
            subject,
            `Hello ${r.full_name},\n\n${alert.title}: ${alert.ticketNumber}\n${body}\n${
              alert.storeName ? `Store: ${alert.storeName}\n` : ""
            }\nOpen it here: ${link}\n\n— Seven Years Care`,
            meta
          )
        );
      }
      if (r.notify_whatsapp && r.whatsapp_number) {
        // Template variables: {{1}} headline · {{2}} summary · {{3}} store · {{4}} link
        jobs.push(
          sendWhatsApp(
            r.whatsapp_number,
            wa.staffTemplate,
            [`${alert.title} ${alert.ticketNumber}`, alert.summary, alert.storeName ?? "Not specified", link],
            meta
          )
        );
      }
      await Promise.all(jobs);
    })
  );
}

/** Update to the customer on WhatsApp (and e-mail when we have one). */
export async function notifyCustomer(input: {
  name: string | null;
  mobile: string | null;
  email?: string | null;
  ticketNumber: string;
  message: string;
}) {
  const link = customerTrackLink(input.ticketNumber);
  const meta = { audience: "customer" as const, ticketNumber: input.ticketNumber };
  const name = input.name?.trim() || "Customer";
  const jobs: Promise<unknown>[] = [];

  if (input.mobile) {
    // Template variables: {{1}} name · {{2}} ticket number · {{3}} update · {{4}} track link
    jobs.push(
      sendWhatsApp(
        input.mobile,
        whatsappSettings().customerTemplate,
        [name, input.ticketNumber, input.message, link],
        meta
      )
    );
  }

  if (input.email) {
    jobs.push(
      sendEmail(
        input.email,
        `Update on your request ${input.ticketNumber}`,
        `Dear ${name},\n\n${input.message}\n\nRequest number: ${input.ticketNumber}\nTrack it any time: ${link}\n\nThank you,\nSeven Years Care`,
        meta
      )
    );
  }

  await Promise.all(jobs);
}
