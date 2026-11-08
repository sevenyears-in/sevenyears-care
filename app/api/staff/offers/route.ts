import { after, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pushToAll, pushToCustomer, saveServiceAccount } from "@/lib/push";
import { saveWishSettings } from "@/lib/wishes";
import { sendWhatsApp, siteUrl, whatsappConfigured } from "@/lib/notify";

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

  if (body.action === "wishes") {
    try {
      const settings = await saveWishSettings(body.settings as Record<string, unknown>);
      return NextResponse.json({ success: true, settings });
    } catch {
      return NextResponse.json({ error: "Could not save." }, { status: 500 });
    }
  }

  if (body.action === "delete") {
    const id = String(body.id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid offer." }, { status: 400 });
    const { error } = await supabaseAdmin.from("offers").delete().eq("id", id);
    if (error) return NextResponse.json({ error: "Could not delete." }, { status: 500 });
    return NextResponse.json({ success: true });
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
  const audience = body.audience === "selected" ? "selected" : "all";
  const mobiles = [...new Set(String(body.mobiles ?? "").split(/[^0-9]+/).map((m) => m.slice(-10)).filter((m) => /^[6-9]\d{9}$/.test(m)))];
  if (audience === "selected" && mobiles.length === 0) {
    return NextResponse.json({ error: "Enter at least one 10-digit customer mobile number." }, { status: 400 });
  }
  if (linkRaw && !/^https:\/\/[^\s]+$/i.test(linkRaw)) return NextResponse.json({ error: "The link must start with https://" }, { status: 400 });

  const viaWhatsApp = body.whatsapp === true;
  if (viaWhatsApp && !(await whatsappConfigured())) {
    return NextResponse.json({ error: "WhatsApp is not connected yet (Settings → Alerts Setup). Untick “Also send on WhatsApp” or set it up first." }, { status: 400 });
  }

  const { data: offer, error } = await supabaseAdmin
    .from("offers")
    .insert({ title, message, link: linkRaw || null, valid_until: validUntil, created_by: by, audience, target_mobiles: mobiles })
    .select("id")
    .single();
  if (error || !offer) {
    console.error("Create offer error:", error);
    return NextResponse.json({ error: "Could not save the offer. Ask the Super Admin to run the latest database update." }, { status: 500 });
  }

  // WhatsApp (template "sy_offer": {{1}} name · {{2}} offer title · {{3}} details) — sent in the background.
  let waNote = "";
  if (viaWhatsApp) {
    const targets =
      audience === "selected"
        ? ((await supabaseAdmin.from("customer_accounts").select("mobile, full_name").in("mobile", mobiles)).data ?? []).concat(
            mobiles.map((m) => ({ mobile: m, full_name: null }))
          )
        : (await supabaseAdmin.from("customer_accounts").select("mobile, full_name").limit(20000)).data ?? [];
    const unique = [...new Map(targets.reverse().map((t) => [t.mobile, t])).values()];
    waNote = ` WhatsApp is going out to ${unique.length} customer${unique.length === 1 ? "" : "s"}.`;
    after(async () => {
      for (const t of unique) {
        const name = String(t.full_name ?? "").split(" ")[0] || "there";
        await sendWhatsApp(t.mobile, "sy_offer", [name, title, message], { audience: "customer", ticketNumber: "offer" });
      }
    });
  }

  try {
    const msg = { title, body: message, url: `${siteUrl()}/offers` };
    let note = "";
    if (audience === "all") await pushToAll(msg);
    else {
      let reached = 0;
      for (const m of mobiles) reached += await pushToCustomer(m, msg);
      note = reached
        ? `Sent to ${reached} phone${reached === 1 ? "" : "s"}. Customers without the app will see it on the Offers page after logging in.`
        : "None of these customers have the app with notifications yet — they will see the offer on the Offers page after logging in.";
    }
    await supabaseAdmin.from("offers").update({ sent_at: new Date().toISOString(), sent_by: by, send_error: null }).eq("id", offer.id);
    return NextResponse.json({ success: true, sent: true, note: (note || "Sent! Customers will get the notification in a few seconds.") + waNote });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sending failed";
    await supabaseAdmin.from("offers").update({ send_error: msg }).eq("id", offer.id);
    return NextResponse.json({ success: true, sent: false, warning: `Offer saved and shown in the app, but the app notification was not sent: ${msg}.${waNote}` });
  }
}
