// WhatsApp complaint bot (server only).
// A customer messages the Seven Years Care WhatsApp number; the bot asks a few
// questions and registers the complaint. Conversation state is kept in the
// Supabase table whatsapp_sessions (one row per mobile number, 30-minute timeout).

import { supabaseAdmin } from "@/lib/supabase/server";
import { sendWhatsAppText, customerTrackLink, siteUrl } from "@/lib/notify";
import { COMPLAINT_CATEGORIES } from "@/lib/site-config";
import { getStores } from "@/lib/stores";
import { createComplaint } from "@/lib/complaints";
import { statusLabel } from "@/lib/helpers";

type State = "idle" | "ask_name" | "ask_store" | "ask_category" | "ask_description";

type SessionData = {
  name?: string;
  storeName?: string | null;
  stores?: string[];
  category?: string;
  lastMessageId?: string;
};

type Session = { state: State; data: SessionData; updatedAt: number };

const TIMEOUT_MS = 30 * 60 * 1000;

async function loadSession(mobile: string): Promise<Session> {
  const { data } = await supabaseAdmin
    .from("whatsapp_sessions")
    .select("state, data, updated_at")
    .eq("mobile", mobile)
    .maybeSingle();
  if (!data) return { state: "idle", data: {}, updatedAt: 0 };
  const updatedAt = new Date(data.updated_at).getTime();
  const expired = Date.now() - updatedAt > TIMEOUT_MS;
  return {
    state: expired ? "idle" : ((data.state as State) ?? "idle"),
    data: { ...(expired ? {} : ((data.data as SessionData) ?? {})), lastMessageId: (data.data as SessionData)?.lastMessageId },
    updatedAt,
  };
}

async function saveSession(mobile: string, state: State, data: SessionData) {
  const { error } = await supabaseAdmin
    .from("whatsapp_sessions")
    .upsert({ mobile, state, data, updated_at: new Date().toISOString() });
  if (error) console.error("WhatsApp session save error:", error);
}

async function knownName(mobile: string) {
  const { data: account } = await supabaseAdmin
    .from("customer_accounts")
    .select("full_name")
    .eq("mobile", mobile)
    .maybeSingle();
  if (account?.full_name) return String(account.full_name);
  const { data: w } = await supabaseAdmin
    .from("warranties")
    .select("customer_name")
    .eq("customer_mobile", mobile)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return w?.customer_name ? String(w.customer_name) : "";
}

const MENU = [
  "Welcome to *Seven Years Care* 👋",
  "",
  "Reply with a number:",
  "*1* – Register a complaint",
  "*2* – Check my requests",
  "*3* – Request service for a product",
  "",
  "Reply *0* at any time to cancel.",
].join("\n");

function numbered(items: string[]) {
  return items.map((item, i) => `*${i + 1}* – ${item}`).join("\n");
}

async function myRequests(mobile: string) {
  const [services, complaints] = await Promise.all([
    supabaseAdmin
      .from("service_requests")
      .select("request_number, issue_type, status, created_at")
      .eq("contact_mobile", mobile)
      .order("created_at", { ascending: false })
      .limit(5),
    supabaseAdmin
      .from("complaints")
      .select("complaint_number, category, status, created_at")
      .eq("contact_mobile", mobile)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const lines = [
    ...(services.data ?? []).map((s) => `• ${s.request_number} – ${s.issue_type}: *${statusLabel(s.status)}*`),
    ...(complaints.data ?? []).map((c) => `• ${c.complaint_number} – ${c.category}: *${statusLabel(c.status)}*`),
  ];
  if (lines.length === 0) return "We couldn't find any service requests or complaints for this number.\n\nReply *1* to register a complaint.";
  return `Your latest requests:\n${lines.join("\n")}\n\nFull details: ${siteUrl()}/account`;
}

/** Handle one incoming text message and send the reply. */
export async function handleWhatsAppMessage(input: { mobile: string; text: string; messageId: string; profileName?: string }) {
  const mobile = input.mobile;
  const text = input.text.trim();
  const session = await loadSession(mobile);

  // Meta can deliver the same message twice — ignore repeats.
  if (input.messageId && session.data.lastMessageId === input.messageId) return;

  const reply = async (body: string, state: State, data: SessionData = {}) => {
    await saveSession(mobile, state, { ...data, lastMessageId: input.messageId });
    await sendWhatsAppText(mobile, body, { audience: "customer", ticketNumber: null });
  };

  const lower = text.toLowerCase();
  if (lower === "0" || lower === "cancel" || lower === "menu" || lower === "hi" || lower === "hello") {
    await reply(lower === "0" || lower === "cancel" ? `Cancelled.\n\n${MENU}` : MENU, "idle");
    return;
  }

  switch (session.state) {
    case "idle": {
      if (lower === "1" || lower.includes("complaint")) {
        const name = (await knownName(mobile)) || "";
        if (name) {
          return startStore(name);
        }
        await reply("Sorry to hear you have a problem. 🙏\n\nPlease type your *name*.", "ask_name");
        return;
      }
      if (lower === "2" || lower.includes("status") || lower.includes("track")) {
        await reply(await myRequests(mobile), "idle");
        return;
      }
      if (lower === "3" || lower.includes("service") || lower.includes("repair")) {
        await reply(
          `To request service for a product with a Seven Years warranty, open:\n${siteUrl()}/request-service\n\nOr log in to your account: ${siteUrl()}/account (User ID: your mobile number, first password: last 4 digits of your bill number).`,
          "idle"
        );
        return;
      }
      await reply(MENU, "idle");
      return;
    }

    case "ask_name": {
      const name = text.replace(/\s+/g, " ").slice(0, 80);
      if (name.length < 2) {
        await reply("Please type your *name*.", "ask_name", session.data);
        return;
      }
      return startStore(name);
    }

    case "ask_store": {
      const stores = session.data.stores ?? [];
      const n = Number(text);
      let storeName: string | null | undefined;
      if (Number.isInteger(n) && n >= 1 && n <= stores.length) storeName = stores[n - 1];
      else if (Number.isInteger(n) && n === stores.length + 1) storeName = null;
      else {
        const match = stores.find((s) => s.toLowerCase() === lower);
        storeName = match;
      }
      if (storeName === undefined) {
        await reply(`Please reply with a number from the list.\n\n${storeQuestion(stores)}`, "ask_store", session.data);
        return;
      }
      await reply(
        `What is the complaint about?\n\n${numbered(COMPLAINT_CATEGORIES)}`,
        "ask_category",
        { ...session.data, storeName }
      );
      return;
    }

    case "ask_category": {
      const n = Number(text);
      const category =
        Number.isInteger(n) && n >= 1 && n <= COMPLAINT_CATEGORIES.length
          ? COMPLAINT_CATEGORIES[n - 1]
          : COMPLAINT_CATEGORIES.find((c) => c.toLowerCase() === lower);
      if (!category) {
        await reply(`Please reply with a number from the list.\n\n${numbered(COMPLAINT_CATEGORIES)}`, "ask_category", session.data);
        return;
      }
      await reply(
        "Please describe the problem in one message (what happened, which product, bill number if you have it).",
        "ask_description",
        { ...session.data, category }
      );
      return;
    }

    case "ask_description": {
      if (text.length < 10) {
        await reply("Please tell us a little more about the problem.", "ask_description", session.data);
        return;
      }
      const billMatch = text.match(/\b[A-Z]{2,5}\d{2}-[A-Z0-9]{2,5}-\d{2,8}\b/i);
      const result = await createComplaint({
        fullName: session.data.name || input.profileName || "WhatsApp customer",
        mobile,
        storeName: session.data.storeName ?? null,
        category: session.data.category ?? "Other",
        reference: billMatch?.[0]?.toUpperCase() ?? null,
        description: text,
        source: "whatsapp",
      });
      if (!result.ok) {
        await reply(`Sorry, we couldn't register it: ${result.error}\n\nReply *1* to try again.`, "idle");
        return;
      }
      await reply(
        [
          "✅ Your complaint has been registered.",
          "",
          `Complaint number: *${result.complaintNumber}*`,
          "Our team will contact you within 2 working hours.",
          "",
          `Track it: ${customerTrackLink(result.complaintNumber)}`,
        ].join("\n"),
        "idle"
      );
      await result.announce();
      return;
    }
  }

  async function startStore(name: string) {
    const stores = (await getStores()).stores.map((s) => s.name);
    if (stores.length === 0) {
      await reply(`Thank you, ${name}.\n\nWhat is the complaint about?\n\n${numbered(COMPLAINT_CATEGORIES)}`, "ask_category", {
        name,
        storeName: null,
      });
      return;
    }
    await reply(`Thank you, ${name}.\n\n${storeQuestion(stores)}`, "ask_store", { name, stores });
  }
}

function storeQuestion(stores: string[]) {
  return `Which Seven Years store is it about?\n\n${numbered([...stores, "Not sure / online"])}`;
}
