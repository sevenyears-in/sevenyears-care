// Alerts to staff (dashboard bell + e-mail + WhatsApp) and updates to customers.
// Server only. Sending never throws: a failed e-mail or WhatsApp message is
// written to notification_log and the request carries on.
//
// Settings: Super Admin → Alerts Setup (saved in Supabase). Anything left blank
// there falls back to these environment variables:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM          → e-mail
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID                       → WhatsApp (Meta Cloud API)
//   WHATSAPP_STAFF_TEMPLATE     (default: staff_ticket_alert)      → 4 variables
//   WHATSAPP_CUSTOMER_TEMPLATE  (default: customer_ticket_update)  → 4 variables
//   WHATSAPP_TEMPLATE_LANGUAGE  (default: en)
// See NOTIFICATIONS-SETUP.md.

import { sendSmtpMail } from "@/lib/smtp";
import { alertSettings } from "@/lib/alert-settings";
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

export async function emailSettings() {
  const a = await alertSettings();
  return { host: a.smtpHost, port: a.smtpPort, user: a.smtpUser, pass: a.smtpPass, from: a.mailFrom };
}

export async function emailConfigured() {
  const s = await emailSettings();
  return Boolean(s.host && s.user && s.pass && s.from);
}

export async function whatsappSettings() {
  const a = await alertSettings();
  return {
    token: a.waToken,
    phoneNumberId: a.waPhoneNumberId,
    staffTemplate: a.waStaffTemplate,
    customerTemplate: a.waCustomerTemplate,
    language: a.waLanguage,
  };
}

export async function whatsappConfigured() {
  const s = await whatsappSettings();
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
  if (!(await emailConfigured())) {
    await log("email", to, "skipped", { ...meta, subject, error: "E-mail is not set up" });
    return { ok: false, error: "E-mail is not set up (add the e-mail settings in Alerts Setup)." };
  }

  try {
    const s = await emailSettings();
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

  if (!(await whatsappConfigured())) {
    await log("whatsapp", to, "skipped", { ...meta, subject: template, error: "WhatsApp is not set up" });
    return { ok: false, error: "WhatsApp is not set up (add the token and phone number ID in Alerts Setup)." };
  }

  const s = await whatsappSettings();
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

/**
 * Free-text WhatsApp reply. Only allowed within 24 hours of the customer's
 * last message (used by the WhatsApp complaint bot).
 */
export async function sendWhatsAppText(
  mobile10: string,
  body: string,
  meta: LogMeta
): Promise<{ ok: boolean; error?: string }> {
  const digits = String(mobile10 ?? "").replace(/\D/g, "").slice(-10);
  if (!/^\d{10}$/.test(digits)) return { ok: false, error: "No valid WhatsApp number" };
  const to = `91${digits}`;
  if (!(await whatsappConfigured())) {
    await log("whatsapp", to, "skipped", { ...meta, subject: "chat reply", error: "WhatsApp is not set up" });
    return { ok: false, error: "WhatsApp is not set up." };
  }
  const s = await whatsappSettings();
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${s.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: body.slice(0, 4000), preview_url: false },
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      const message = data.error?.message ?? `HTTP ${response.status}`;
      await log("whatsapp", to, "failed", { ...meta, subject: "chat reply", error: message });
      return { ok: false, error: message };
    }
    await log("whatsapp", to, "sent", { ...meta, subject: "chat reply" });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log("whatsapp", to, "failed", { ...meta, subject: "chat reply", error: message });
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
  complaint: ["store_manager", "hr_head", "operations_manager", "cre"],
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
    // Store teams only hear about their own store; corporate office staff hear about every store.
    .filter((row) => {
      if (row.role === "super_admin" || row.role === "admin") return true; // admins cover every store
      if (sameStore(row.store_name, storeName)) return true;
      if (STORE_SCOPED_ROLES.includes(row.role)) return false;
      return !row.store_name || sameStore(row.store_name, "CORPORATE OFFICE");
    });
}

/** Directors who look after this store (a Director with no stores set looks after all stores). */
export async function findDirectors(storeName: string | null): Promise<Recipient[]> {
  const { data, error } = await supabaseAdmin
    .from("staff_users")
    .select(`${RECIPIENT_COLUMNS}, director_stores`)
    .eq("is_active", true)
    .eq("role", "director");
  if (error) {
    console.error("Director lookup failed:", error);
    return [];
  }
  return (data ?? [])
    .filter((row) => {
      const stores = Array.isArray(row.director_stores) ? (row.director_stores as string[]) : [];
      return stores.length === 0 || stores.some((s) => sameStore(s, storeName));
    })
    .map(({ director_stores: _ds, ...row }) => {
      void _ds;
      return { ...row, role: asRole(row.role) } as Recipient;
    });
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
  /** null for alerts that are not about a service request / complaint (they use `link`). */
  ticketType: TicketType | null;
  ticketId: string | null;
  ticketNumber: string;
  /** Short headline, e.g. "New service request" */
  title: string;
  /** One-line summary for WhatsApp, e.g. "Stroller — Wheel, brake or frame issue · Customer: Anu" */
  summary: string;
  /** Extra lines for the e-mail and dashboard alert. */
  details?: string[];
  storeName: string | null;
  /** Open this page instead of the ticket (e.g. My Explanations). */
  link?: string;
};

/** Dashboard alert + e-mail + WhatsApp to each staff member (once each). */
export async function notifyStaff(recipients: Recipient[], alert: StaffAlert, exceptStaffId?: string) {
  const unique = new Map<string, Recipient>();
  for (const r of recipients) if (r.id !== exceptStaffId) unique.set(r.id, r);
  const list = [...unique.values()];
  if (list.length === 0) return;

  const link =
    alert.link ||
    (alert.ticketType && alert.ticketId ? staffTicketLink(alert.ticketType, alert.ticketId) : `${siteUrl()}/staff/alerts`);
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
  const wa = await whatsappSettings();

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
  /** Link to send instead of the track page (e.g. feedback / confirm link). */
  link?: string;
}) {
  const link = input.link || customerTrackLink(input.ticketNumber);
  const meta = { audience: "customer" as const, ticketNumber: input.ticketNumber };
  const name = input.name?.trim() || "Customer";
  const jobs: Promise<unknown>[] = [];

  if (input.mobile) {
    // Template variables: {{1}} name · {{2}} ticket number · {{3}} update · {{4}} track link
    jobs.push(
      sendWhatsApp(
        input.mobile,
        (await whatsappSettings()).customerTemplate,
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
