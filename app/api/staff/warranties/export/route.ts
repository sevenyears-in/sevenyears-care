import { hasSection } from "@/lib/access";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";
import { applyFilters, readFilters } from "@/lib/warranty-search";

// GET /api/staff/warranties/export?…same filters as the list… → CSV (opens in Excel)
// with every detail of each warranty. Read in batches so a large export stays light.

const COLUMNS: [string, string][] = [
  ["warranty_number", "Warranty No."],
  ["status", "Status"],
  ["bill_number", "Bill No."],
  ["bill_date", "Bill Date"],
  ["store_name", "Store"],
  ["product_name", "Product"],
  ["category_name", "Category"],
  ["sku", "SKU"],
  ["model_number", "Model No."],
  ["serial_number", "Serial No."],
  ["customer_name", "Customer Name"],
  ["customer_mobile", "Customer Mobile"],
  ["customer_address", "Address"],
  ["alternate_name", "Gift Recipient"],
  ["alternate_mobile", "Recipient Mobile"],
  ["warranty_start_date", "Warranty Start"],
  ["standard_warranty_expiry_date", "Standard Warranty Until"],
  ["extended_warranty_purchased", "Extended Warranty"],
  ["extended_warranty_fee", "Extended Fee (Rs)"],
  ["extended_warranty_expiry_date", "Extended Until"],
  ["warranty_expiry_date", "Covered Until"],
  ["created_at", "Registered On"],
];

const BATCH = 1000;
const MAX_ROWS = 50_000;

function cell(value: unknown) {
  if (value === null || value === undefined) return "";
  let s = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // never let Excel run a formula
  // Long numbers (mobile) stay as text in Excel
  if (/^\d{10,}$/.test(s)) s = `="${s}"`;
  return /[",\r\n]/.test(s) && !s.startsWith('="') ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  if (!hasSection(auth.staff, "warranties")) return NextResponse.json({ error: "You don't have access to this section." }, { status: 403 });

  const filters = readFilters(request.url);
  const lines = ["﻿" + COLUMNS.map(([, label]) => label).join(",")];
  const today = todayISO();

  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    const { data, error } = await applyFilters(
      supabaseAdmin.from("warranties").select(COLUMNS.map(([key]) => key).join(", ")),
      filters
    )
      .order("bill_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + BATCH - 1);
    if (error) {
      console.error("Warranty export error:", error);
      return new Response("Unable to export warranties. Please try again.", { status: 500 });
    }
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    for (const r of rows) {
      const row = { ...r };
      if (row.status === "active" && String(row.warranty_expiry_date) < today) row.status = "expired";
      if (row.created_at) row.created_at = String(row.created_at).slice(0, 10);
      lines.push(COLUMNS.map(([key]) => cell(row[key])).join(","));
    }
    if (rows.length < BATCH) break;
  }

  const name = `warranties-${filters.store ? filters.store.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "-" : ""}${today}.csv`;
  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
