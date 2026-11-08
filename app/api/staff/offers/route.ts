import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pushToAll, saveServiceAccount } from "@/lib/push";
import { siteUrl } from "@/lib/notify";

const clean = (v: unknown, max: number) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);

// POST /api/staff/offers
//   { action: "send", title, message, link?, validUntil? }  → save + notify every app user
//   { action: "stop", id }                                  → hide an offer
//   { action: "setup", key }                                → Super Admin: Firebase key file
export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  if (!isAdmin(auth.staff.role)) return NextResponse.json({ error: "Only the Super Admin or Admin can send offers." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const by = `${auth.staff.fullName} (${auth.staff.userId})`;

  if (body.action === "setup") {
    if (auth.staff.role !== "super_admin") return NextResponse.json({ error: "Only the Super Admin can set this up." }, { status: 403 });
    const result = await saveServiceAccount(String(body.key ?? ""));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, email: result.email });
  }

  if (body.action === "stop") {
    const id = String(body.id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid offer." }, { status: 400 });
    await supabaseAdmin.from("offers").update({ is_active: false }).eq("id", id);
    return NextResponse.json({ success: true });
  }

  const title = clean(body.title, 80);
  const message = clean(body.message, 400);
  const linkRaw = clean(body.link, 300);
  const validUntil = /^\d{4}-\d{2}-\d{2}$/.test(String(body.validUntil ?? "")) ? String(body.validUntil) : null;
  if (title.length < 3 || message.length < 5) return NextResponse.json({ error: "Enter a title and a message." }, { status: 400 });
  if (linkRaw && !/^https:\/\/[^\s]+$/i.test(linkRaw)) return NextResponse.json({ error: "The link must start with https://" }, { status: 400 });

  const { data: offer, error } = await supabaseAdmin
    .from("offers")
    .insert({ title, message, link: linkRaw || null, valid_until: validUntil, created_by: by })
    .select("id")
    .single();
  if (error || !offer) {
    console.error("Create offer error:", error);
    return NextResponse.json({ error: "Could not save the offer. Ask the Super Admin to run the latest database update." }, { status: 500 });
  }

  try {
    await pushToAll({ title, body: message, url: `${siteUrl()}/offers` });
    await supabaseAdmin.from("offers").update({ sent_at: new Date().toISOString(), sent_by: by, send_error: null }).eq("id", offer.id);
    return NextResponse.json({ success: true, sent: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sending failed";
    await supabaseAdmin.from("offers").update({ send_error: msg }).eq("id", offer.id);
    return NextResponse.json({ success: true, sent: false, warning: `Offer saved and shown in the app, but the notification was not sent: ${msg}` });
  }
}
