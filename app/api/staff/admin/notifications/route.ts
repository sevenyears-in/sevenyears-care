import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import {
  emailConfigured,
  sendEmail,
  sendWhatsApp,
  whatsappConfigured,
  whatsappSettings,
  siteUrl,
} from "@/lib/notify";
import {
  alertSettings,
  loadSavedAlertSettings,
  newCronSecret,
  saveAlertSettings,
  type AlertSettings,
} from "@/lib/alert-settings";

// Super Admin only: Alerts Setup.
// GET  → current settings (passwords / tokens are never sent back, only "saved: yes/no")
// PUT  → save settings { smtpHost, smtpPort, ..., smtpPass?, waToken?, clearSmtpPass?, clearWaToken?, newCronKey? }
// POST → send a test to yourself { channel: "email" | "whatsapp" }

async function view() {
  const saved = await loadSavedAlertSettings(true);
  const used = await alertSettings();
  return {
    smtpHost: used.smtpHost,
    smtpPort: used.smtpPort,
    smtpUser: used.smtpUser,
    mailFrom: used.mailFrom,
    smtpPassSaved: Boolean(used.smtpPass),
    waPhoneNumberId: used.waPhoneNumberId,
    waStaffTemplate: used.waStaffTemplate,
    waCustomerTemplate: used.waCustomerTemplate,
    waLanguage: used.waLanguage,
    waTokenSaved: Boolean(used.waToken),
    cronUrl: used.cronSecret ? `${siteUrl()}/api/cron/sla?key=${encodeURIComponent(used.cronSecret)}` : "",
    emailReady: await emailConfigured(),
    whatsappReady: await whatsappConfigured(),
    cronReady: used.cronSecret.length >= 16,
    savedInApp: Object.keys(saved).length > 0,
  };
}

export async function GET() {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  return NextResponse.json(await view());
}

const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);

export async function PUT(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const saved = await loadSavedAlertSettings(true);
  const next: Partial<AlertSettings> = { ...saved };

  const smtpHost = text(body.smtpHost);
  if (smtpHost && !/^[a-z0-9.-]+$/i.test(smtpHost)) {
    return NextResponse.json({ error: "Mail server should look like smtp.hostinger.com" }, { status: 400 });
  }
  const port = Number(body.smtpPort || 465);
  if (![465, 587, 25, 2525].includes(port)) {
    return NextResponse.json({ error: "Port should be 465 (SSL) or 587 (STARTTLS)." }, { status: 400 });
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const smtpUser = text(body.smtpUser);
  const mailFrom = text(body.mailFrom);
  if (mailFrom && !emailRe.test(mailFrom)) {
    return NextResponse.json({ error: "“Send from” must be an e-mail address." }, { status: 400 });
  }

  const phoneId = text(body.waPhoneNumberId, 40);
  if (phoneId && !/^\d{6,25}$/.test(phoneId)) {
    return NextResponse.json({ error: "WhatsApp Phone number ID is numbers only (from Meta → API Setup)." }, { status: 400 });
  }
  const template = (value: unknown, fallback: string) => {
    const t = text(value, 100);
    return /^[a-z0-9_]*$/.test(t) ? t || fallback : null;
  };
  const staffTemplate = template(body.waStaffTemplate, "staff_ticket_alert");
  const customerTemplate = template(body.waCustomerTemplate, "customer_ticket_update");
  if (!staffTemplate || !customerTemplate) {
    return NextResponse.json({ error: "Template names use small letters, numbers and _ only." }, { status: 400 });
  }
  const language = text(body.waLanguage, 10) || "en";
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(language)) {
    return NextResponse.json({ error: "Template language should be like en or en_US." }, { status: 400 });
  }

  next.smtpHost = smtpHost;
  next.smtpPort = port;
  next.smtpUser = smtpUser;
  next.mailFrom = mailFrom;
  next.waPhoneNumberId = phoneId;
  next.waStaffTemplate = staffTemplate;
  next.waCustomerTemplate = customerTemplate;
  next.waLanguage = language;

  // Password / token: blank = keep the saved one.
  const smtpPass = String(body.smtpPass ?? "");
  if (smtpPass) next.smtpPass = smtpPass.slice(0, 300);
  if (body.clearSmtpPass === true) next.smtpPass = "";
  const waToken = String(body.waToken ?? "").trim();
  if (waToken) next.waToken = waToken.slice(0, 1000);
  if (body.clearWaToken === true) next.waToken = "";

  if (body.newCronKey === true || !(next.cronSecret || process.env.CRON_SECRET)) {
    next.cronSecret = newCronSecret();
  }

  try {
    await saveAlertSettings(next);
  } catch (error) {
    console.error("Save alert settings error:", error);
    return NextResponse.json({ error: "Unable to save the settings." }, { status: 500 });
  }

  return NextResponse.json({ success: true, settings: await view() });
}

export async function POST(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { channel?: string };
  const staff = auth.staff;

  if (body.channel === "email") {
    if (!(await emailConfigured())) return NextResponse.json({ error: "E-mail is not set up yet." }, { status: 400 });
    if (!staff.email) return NextResponse.json({ error: "Add your e-mail address in Staff Users first." }, { status: 400 });
    const result = await sendEmail(
      staff.email,
      "Seven Years Care — test e-mail",
      `Hello ${staff.fullName},\n\nE-mail alerts are working.\n\n${siteUrl()}/staff`,
      { audience: "staff", ticketNumber: "TEST" }
    );
    return result.ok
      ? NextResponse.json({ success: true, message: `Test e-mail sent to ${staff.email}.` })
      : NextResponse.json({ error: result.error }, { status: 502 });
  }

  if (body.channel === "whatsapp") {
    if (!(await whatsappConfigured())) return NextResponse.json({ error: "WhatsApp is not set up yet." }, { status: 400 });
    if (!staff.whatsappNumber)
      return NextResponse.json({ error: "Add your WhatsApp number in Staff Users first." }, { status: 400 });
    const result = await sendWhatsApp(
      staff.whatsappNumber,
      (await whatsappSettings()).staffTemplate,
      ["Test alert SY-TEST", "WhatsApp alerts are working", "All stores", `${siteUrl()}/staff`],
      { audience: "staff", ticketNumber: "TEST" }
    );
    return result.ok
      ? NextResponse.json({ success: true, message: `Test WhatsApp sent to ${staff.whatsappNumber}.` })
      : NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ error: "Choose e-mail or WhatsApp." }, { status: 400 });
}
