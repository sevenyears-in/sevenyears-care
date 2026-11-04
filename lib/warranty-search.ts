// Staff warranty list: filters shared by the Warranties page and the download.

import { supabaseAdmin } from "@/lib/supabase/server";
import { isISODate, todayISO } from "@/lib/helpers";

export type WarrantyFilters = {
  q: string;
  store: string;
  from: string; // bill date from (YYYY-MM-DD) or ""
  to: string;
  status: "" | "active" | "expired" | "void" | "incomplete" | "gift";
};

export function readFilters(url: string): WarrantyFilters {
  const p = new URL(url).searchParams;
  const date = (v: string | null) => (v && isISODate(v) ? v : "");
  const status = p.get("status") ?? "";
  return {
    q: (p.get("q") ?? "").trim().slice(0, 80),
    store: (p.get("store") ?? "").trim().slice(0, 120),
    from: date(p.get("from")),
    to: date(p.get("to")),
    status: (["active", "expired", "void", "incomplete", "gift"].includes(status) ? status : "") as WarrantyFilters["status"],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyFilters<T extends { or: any; eq: any; gte: any; lte: any; lt: any; ilike: any; not: any }>(query: T, f: WarrantyFilters): T {
  let q = query;
  if (f.q) {
    const safe = f.q.replace(/[,()*%]/g, " ").trim();
    const mobile = f.q.replace(/\D/g, "");
    const filters = [
      `warranty_number.ilike.%${safe}%`,
      `bill_number.ilike.%${safe}%`,
      `serial_number.ilike.%${safe}%`,
      `customer_name.ilike.%${safe}%`,
      `product_name.ilike.%${safe}%`,
    ];
    if (mobile.length >= 4) filters.push(`customer_mobile.like.%${mobile}%`, `alternate_mobile.like.%${mobile}%`);
    q = q.or(filters.join(","));
  }
  if (f.store) q = q.ilike("store_name", f.store.replace(/[%_]/g, ""));
  if (f.from) q = q.gte("bill_date", f.from);
  if (f.to) q = q.lte("bill_date", f.to);
  const today = todayISO();
  if (f.status === "active") q = q.eq("status", "active").gte("warranty_expiry_date", today);
  if (f.status === "expired") q = q.eq("status", "active").lt("warranty_expiry_date", today);
  if (f.status === "void") q = q.eq("status", "void");
  if (f.status === "incomplete") q = q.or("serial_number.eq.Not recorded,customer_address.eq.Not recorded");
  if (f.status === "gift") q = q.not("alternate_mobile", "is", null);
  return q;
}

export const LIST_COLUMNS =
  "id, warranty_number, verification_token, bill_number, bill_date, store_name, product_name, model_number, serial_number, customer_name, customer_mobile, alternate_name, alternate_mobile, warranty_expiry_date, extended_warranty_purchased, status, created_at";

export const PAGE_SIZE = 50;

export async function searchWarranties(f: WarrantyFilters, page: number) {
  const fromRow = (page - 1) * PAGE_SIZE;
  const query = applyFilters(
    supabaseAdmin.from("warranties").select(LIST_COLUMNS, { count: "exact" }),
    f
  )
    .order("bill_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(fromRow, fromRow + PAGE_SIZE - 1);
  return query;
}
