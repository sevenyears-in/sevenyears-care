import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { emailConfigured, sendEmail, sendWhatsApp, whatsappConfigured, whatsappSettings, siteUrl } from "@/lib/notify";

// Super Admin: send a test e-mail / WhatsApp alert to yourself.
// POST { channel: "email" | "whatsapp" }

export async function POST(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { channel?: string };
  const staff = auth.staff;

  if (body.channel === "email") {
    if (!emailConfigured()) return NextResponse.json({ error: "E-mail is not set up yet." }, { status: 400 });
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
    if (!whatsappConfigured()) return NextResponse.json({ error: "WhatsApp is not set up yet." }, { status: 400 });
    if (!staff.whatsappNumber)
      return NextResponse.json({ error: "Add your WhatsApp number in Staff Users first." }, { status: 400 });
    const result = await sendWhatsApp(
      staff.whatsappNumber,
      whatsappSettings().staffTemplate,
      ["Test alert SY-TEST", "WhatsApp alerts are working", "All stores", `${siteUrl()}/staff`],
      { audience: "staff", ticketNumber: "TEST" }
    );
    return result.ok
      ? NextResponse.json({ success: true, message: `Test WhatsApp sent to ${staff.whatsappNumber}.` })
      : NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ error: "Choose e-mail or WhatsApp." }, { status: 400 });
}
