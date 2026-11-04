// Extended warranty sold after the purchase (server only).
//
// - Within N days (default 10) of the bill date: the customer pays online straight away.
// - Later, while the warranty is still running: a technician inspects the product first;
//   once approved the customer pays online (or at the store).
// Price and Razorpay keys are set by the Super Admin (Staff → Settings → Extended Warranty).

import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { addMonths, todayISO } from "@/lib/helpers";

const KEY = "extended_warranty";

export type ExtendedSettings = {
  price: number;
  months: number;
  windowDays: number;
  onlineEnabled: boolean;
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpayWebhookSecret: string;
};

export const DEFAULT_EXTENDED: ExtendedSettings = {
  price: 1499,
  months: 6,
  windowDays: 10,
  onlineEnabled: false,
  razorpayKeyId: "",
  razorpayKeySecret: "",
  razorpayWebhookSecret: "",
};

export async function extendedSettings(): Promise<ExtendedSettings> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    const v = (data?.value ?? {}) as Partial<ExtendedSettings>;
    return {
      price: Number(v.price) > 0 ? Number(v.price) : DEFAULT_EXTENDED.price,
      months: Number(v.months) > 0 ? Number(v.months) : DEFAULT_EXTENDED.months,
      windowDays: Number(v.windowDays) > 0 ? Number(v.windowDays) : DEFAULT_EXTENDED.windowDays,
      onlineEnabled: Boolean(v.onlineEnabled),
      razorpayKeyId: String(v.razorpayKeyId ?? ""),
      razorpayKeySecret: String(v.razorpayKeySecret ?? ""),
      razorpayWebhookSecret: String(v.razorpayWebhookSecret ?? ""),
    };
  } catch {
    return DEFAULT_EXTENDED;
  }
}

export async function saveExtendedSettings(value: ExtendedSettings) {
  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ key: KEY, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export function onlinePaymentsReady(s: ExtendedSettings) {
  return s.onlineEnabled && Boolean(s.razorpayKeyId && s.razorpayKeySecret);
}

export function rupees(amount: number) {
  return `₹${Number(amount).toLocaleString("en-IN")}`;
}

// ------------------------------------------------------------------
// Warranty + eligibility
// ------------------------------------------------------------------

export type WarrantyForExtension = {
  id: string;
  warranty_number: string;
  verification_token: string;
  bill_number: string;
  bill_date: string;
  store_name: string | null;
  product_name: string;
  category_name: string | null;
  serial_number: string;
  customer_name: string;
  customer_mobile: string;
  standard_warranty_expiry_date: string;
  extended_warranty_purchased: boolean;
  warranty_expiry_date: string;
  status: string;
};

const W_COLS =
  "id, warranty_number, verification_token, bill_number, bill_date, store_name, product_name, category_name, serial_number, customer_name, customer_mobile, standard_warranty_expiry_date, extended_warranty_purchased, warranty_expiry_date, status";

export async function warrantyByToken(token: string) {
  if (!/^[a-f0-9]{16,64}$/i.test(token)) return null;
  const { data } = await supabaseAdmin.from("warranties").select(W_COLS).eq("verification_token", token).maybeSingle();
  return (data as WarrantyForExtension | null) ?? null;
}

export async function warrantyById(id: string) {
  const { data } = await supabaseAdmin.from("warranties").select(W_COLS).eq("id", id).maybeSingle();
  return (data as WarrantyForExtension | null) ?? null;
}

export type ExtensionRequest = {
  id: string;
  warranty_id: string;
  warranty_number: string;
  kind: "direct" | "inspection";
  status: "pending_inspection" | "inspection_failed" | "awaiting_payment" | "paid" | "cancelled";
  price: number;
  months: number;
  store_name: string | null;
  customer_name: string | null;
  customer_mobile: string | null;
  product_name: string | null;
  inspection_note: string | null;
  inspected_by_name: string | null;
  inspected_at: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  payment_mode: string | null;
  paid_at: string | null;
  created_at: string;
};

export async function latestRequest(warrantyId: string): Promise<ExtensionRequest | null> {
  const { data } = await supabaseAdmin
    .from("warranty_extensions")
    .select("*")
    .eq("warranty_id", warrantyId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ExtensionRequest | null) ?? null;
}

function daysBetween(fromISO: string, toISO: string) {
  return Math.floor((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000);
}

export type Eligibility =
  | { ok: false; reason: string }
  | {
      ok: true;
      mode: "direct" | "inspection";
      /** Last day to buy without inspection (direct mode). */
      directUntil: string;
      price: number;
      months: number;
      newExpiry: string;
      request: ExtensionRequest | null;
    };

export async function eligibility(w: WarrantyForExtension, s?: ExtendedSettings): Promise<Eligibility> {
  const settings = s ?? (await extendedSettings());
  const today = todayISO();
  if (w.status !== "active") return { ok: false, reason: "This warranty is not active." };
  if (w.extended_warranty_purchased) return { ok: false, reason: "Extended warranty is already added." };
  if (w.standard_warranty_expiry_date < today) {
    return { ok: false, reason: "The warranty has expired, so it can't be extended." };
  }
  if (w.category_name) {
    const { data: cat } = await supabaseAdmin
      .from("warranty_categories")
      .select("extended_allowed")
      .ilike("category_name", w.category_name)
      .limit(1)
      .maybeSingle();
    if (cat && cat.extended_allowed === false) {
      return { ok: false, reason: "Extended warranty is not available for this product category." };
    }
  }
  const age = daysBetween(w.bill_date, today);
  const until = new Date(Date.parse(`${w.bill_date}T00:00:00Z`) + settings.windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const request = await latestRequest(w.id).catch(() => null);
  return {
    ok: true,
    mode: age <= settings.windowDays ? "direct" : "inspection",
    directUntil: until,
    price: isApprovedInspection(request) ? Number(request!.price) : settings.price,
    months: settings.months,
    newExpiry: addMonths(w.standard_warranty_expiry_date, settings.months),
    request,
  };
}

/** An inspection that passed and is waiting for the customer to pay. */
export function isApprovedInspection(r: ExtensionRequest | null | undefined) {
  return Boolean(r && r.kind === "inspection" && r.status === "awaiting_payment");
}

/** Can the customer pay right now? (within the first days, or after a passed inspection) */
export function canPayNow(e: Eligibility) {
  if (!e.ok) return false;
  if (isApprovedInspection(e.request)) return true;
  return e.mode === "direct" && e.request?.status !== "pending_inspection";
}

// ------------------------------------------------------------------
// Applying the extension
// ------------------------------------------------------------------

export async function applyExtension(input: {
  requestId: string;
  paymentMode: "online" | "store";
  paymentId?: string | null;
  staffName?: string | null;
}) {
  const { data: req } = await supabaseAdmin.from("warranty_extensions").select("*").eq("id", input.requestId).maybeSingle();
  if (!req) return { ok: false as const, error: "Request not found." };
  if (req.status === "paid") return { ok: true as const, already: true, request: req as ExtensionRequest };

  const w = await warrantyById(String(req.warranty_id));
  if (!w) return { ok: false as const, error: "Warranty not found." };

  const months = Number(req.months) || DEFAULT_EXTENDED.months;
  const start = w.standard_warranty_expiry_date;
  const expiry = addMonths(start, months);
  const now = new Date().toISOString();

  // Mark paid first (only once), then extend the warranty.
  const { data: updated, error } = await supabaseAdmin
    .from("warranty_extensions")
    .update({
      status: "paid",
      paid_at: now,
      payment_mode: input.paymentMode,
      razorpay_payment_id: input.paymentId ?? req.razorpay_payment_id ?? null,
      paid_marked_by: input.staffName ?? null,
    })
    .eq("id", req.id)
    .neq("status", "paid")
    .select("id");
  if (error) {
    console.error("Mark extension paid error:", error);
    return { ok: false as const, error: "Unable to save the payment." };
  }
  if (!updated?.length) return { ok: true as const, already: true, request: req as ExtensionRequest };

  const { error: wErr } = await supabaseAdmin
    .from("warranties")
    .update({
      extended_warranty_purchased: true,
      extended_warranty_fee: Number(req.price),
      extended_warranty_start_date: start,
      extended_warranty_expiry_date: expiry,
      warranty_expiry_date: expiry,
    })
    .eq("id", w.id);
  if (wErr) console.error("Apply extension to warranty error:", wErr);

  return { ok: true as const, already: false, request: req as ExtensionRequest, expiry, warranty: w };
}

// ------------------------------------------------------------------
// Razorpay
// ------------------------------------------------------------------

export async function createRazorpayOrder(s: ExtendedSettings, amountRupees: number, receipt: string, notes: Record<string, string>) {
  const auth = Buffer.from(`${s.razorpayKeyId}:${s.razorpayKeySecret}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: Math.round(amountRupees * 100), currency: "INR", receipt: receipt.slice(0, 40), notes }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
  if (!response.ok || !data.id) {
    console.error("Razorpay order error:", response.status, data);
    throw new Error(data.error?.description || "Could not start the payment. Please try again.");
  }
  return data.id;
}

function sameHex(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function validPaymentSignature(s: ExtendedSettings, orderId: string, paymentId: string, signature: string) {
  const expected = createHmac("sha256", s.razorpayKeySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return sameHex(expected, signature);
}

export function validWebhookSignature(s: ExtendedSettings, rawBody: string, signature: string) {
  if (!s.razorpayWebhookSecret) return false;
  const expected = createHmac("sha256", s.razorpayWebhookSecret).update(rawBody).digest("hex");
  return sameHex(expected, signature);
}
