// Automatic wishes on children's birthdays, parents' birthdays and wedding anniversaries
// (phone notification to customers who have the app). Safe to run many times a day:
// each wish is recorded once per person per day.

import { supabaseAdmin } from "@/lib/supabase/server";
import { pushToCustomer } from "@/lib/push";
import { sendWhatsApp, whatsappConfigured } from "@/lib/notify";

// WhatsApp templates (created and approved in Meta WhatsApp Manager).
export const WA_BIRTHDAY_TEMPLATE = "sy_birthday_wish"; // {{1}} customer name · {{2}} who is celebrating
export const WA_ANNIVERSARY_TEMPLATE = "sy_anniversary_wish"; // {{1}} customer name

const KEY = "wishes";

export type WishSettings = { enabled: boolean; whatsapp: boolean; child: string; father: string; mother: string; anniversary: string };

export const DEFAULT_WISHES: WishSettings = {
  enabled: true,
  whatsapp: true,
  child: "Happy Birthday, {child}! 🎂 Wishing your little one a wonderful year ahead — with love from Seven Years.",
  father: "Happy Birthday! 🎉 Warm wishes to the dad of the family from all of us at Seven Years.",
  mother: "Happy Birthday! 🌸 Warm wishes to the mom of the family from all of us at Seven Years.",
  anniversary: "Happy Anniversary! 💐 Wishing you both love and happiness — Seven Years.",
};

export async function loadWishSettings(): Promise<WishSettings> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  return { ...DEFAULT_WISHES, ...((data?.value as Partial<WishSettings>) ?? {}) };
}

export async function saveWishSettings(input: Partial<WishSettings>) {
  const clean = (v: unknown, d: string) => String(v ?? d).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 300) || d;
  const value: WishSettings = {
    enabled: input.enabled !== false,
    whatsapp: input.whatsapp !== false,
    child: clean(input.child, DEFAULT_WISHES.child),
    father: clean(input.father, DEFAULT_WISHES.father),
    mother: clean(input.mother, DEFAULT_WISHES.mother),
    anniversary: clean(input.anniversary, DEFAULT_WISHES.anniversary),
  };
  const { error } = await supabaseAdmin.from("app_settings").upsert({ key: KEY, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  return value;
}

/** Today in India: { date: "2026-11-08", md: "11-08", hour } */
function indiaToday() {
  const now = new Date(Date.now() + 5.5 * 3600_000);
  const date = now.toISOString().slice(0, 10);
  return { date, md: date.slice(5), hour: now.getUTCHours(), leap: new Date(Date.UTC(now.getUTCFullYear(), 1, 29)).getUTCMonth() === 1 };
}

/** Does a date of birth / anniversary fall today? 29 Feb is celebrated on 28 Feb in other years. */
function isToday(dob: string | null | undefined, md: string, leap: boolean) {
  if (!dob) return false;
  const d = String(dob).slice(5, 10);
  return d === md || (d === "02-29" && !leap && md === "02-28");
}

let lastRun = 0;

/** Send today's wishes (only from 8 am India time). Returns how many were sent. */
export async function runWishes(force = false) {
  if (!force && Date.now() - lastRun < 20 * 60_000) return { skipped: true, sent: 0 };
  lastRun = Date.now();
  const settings = await loadWishSettings();
  const { date, md, hour, leap } = indiaToday();
  if (!settings.enabled || hour < 8) return { skipped: true, sent: 0 };

  const { data: families, error } = await supabaseAdmin.from("customer_family").select("mobile, children, father_dob, mother_dob, anniversary");
  if (error || !families?.length) return { skipped: false, sent: 0 };

  type Wish = { mobile: string; kind: string; detail: string; text: string; who: string };
  const wishes: Wish[] = [];
  for (const f of families) {
    for (const c of (Array.isArray(f.children) ? f.children : []) as { name?: string; dob?: string }[]) {
      if (c.dob && c.dob <= date && isToday(c.dob, md, leap)) {
        const child = String(c.name ?? "").trim() || "little one";
        wishes.push({ mobile: f.mobile, kind: "child_birthday", detail: child, text: settings.child.replaceAll("{child}", child), who: c.name ? `little ${child}` : "your little one" });
      }
    }
    if (isToday(f.father_dob, md, leap)) wishes.push({ mobile: f.mobile, kind: "father_birthday", detail: "", text: settings.father, who: "the dad of your family" });
    if (isToday(f.mother_dob, md, leap)) wishes.push({ mobile: f.mobile, kind: "mother_birthday", detail: "", text: settings.mother, who: "the mom of your family" });
    if (isToday(f.anniversary, md, leap)) wishes.push({ mobile: f.mobile, kind: "anniversary", detail: "", text: settings.anniversary, who: "" });
  }

  const useWhatsApp = settings.whatsapp && (await whatsappConfigured());
  const names = new Map<string, string>();
  if (useWhatsApp && wishes.length) {
    const { data } = await supabaseAdmin.from("customer_accounts").select("mobile, full_name").in("mobile", [...new Set(wishes.map((w) => w.mobile))]);
    for (const a of data ?? []) names.set(a.mobile, String(a.full_name ?? "").split(" ")[0] || "there");
  }

  let sent = 0;
  for (const w of wishes) {
    // Claim the wish first so two runs never send it twice.
    const { data: claimed } = await supabaseAdmin
      .from("customer_wishes_sent")
      .upsert({ mobile: w.mobile, kind: w.kind, detail: w.detail, wish_date: date }, { onConflict: "mobile,kind,detail,wish_date", ignoreDuplicates: true })
      .select("id");
    if (!claimed?.length) continue;
    try {
      const title = w.kind === "anniversary" ? "Happy Anniversary 💐" : "Happy Birthday 🎂";
      const delivered = await pushToCustomer(w.mobile, { title, body: w.text }).catch(() => 0);
      let wa: { ok: boolean; error?: string } | null = null;
      if (useWhatsApp) {
        const name = names.get(w.mobile) ?? "there";
        wa =
          w.kind === "anniversary"
            ? await sendWhatsApp(w.mobile, WA_ANNIVERSARY_TEMPLATE, [name], { audience: "customer", ticketNumber: "wish" })
            : await sendWhatsApp(w.mobile, WA_BIRTHDAY_TEMPLATE, [name, w.who], { audience: "customer", ticketNumber: "wish" });
      }
      const ok = delivered > 0 || Boolean(wa?.ok);
      await supabaseAdmin
        .from("customer_wishes_sent")
        .update({
          sent: ok,
          error: ok ? null : wa?.error ? `WhatsApp: ${wa.error}` : "No app or WhatsApp for this customer",
        })
        .eq("id", claimed[0].id);
      if (ok) sent++;
    } catch (e) {
      await supabaseAdmin.from("customer_wishes_sent").update({ error: e instanceof Error ? e.message : "failed" }).eq("id", claimed[0].id);
    }
  }
  return { skipped: false, sent, due: wishes.length };
}
