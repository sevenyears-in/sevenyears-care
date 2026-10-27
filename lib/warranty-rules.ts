// Turns a Zoho bill into warranty rows (server only).
// Used by both the bill lookup (to show the rows) and the save step
// (which re-checks everything against Zoho instead of trusting the browser).

import { supabaseAdmin } from "@/lib/supabase/server";
import type { Bill } from "@/lib/zoho";

export type Category = {
  category_name: string;
  standard_months: number;
  extended_allowed: boolean;
};

export type WarrantyRow = {
  key: string; // `${lineItemId}#${unitIndex}`
  lineItemId: string;
  itemId: string | null;
  unitIndex: number;
  unitCount: number;
  productName: string;
  sku: string | null;
  suggestedModel: string;
  categoryName: string;
  standardMonths: number;
  extendedAllowed: boolean;
  existing: null | {
    warrantyNumber: string;
    token: string;
    modelNumber: string;
    serialNumber: string;
    customerName: string;
  };
};

export type IneligibleLine = {
  name: string;
  sku: string | null;
  quantity: number;
  categoryName: string | null;
};

export async function loadActiveCategories() {
  const { data, error } = await supabaseAdmin
    .from("warranty_categories")
    .select("category_name, standard_months, extended_allowed")
    .eq("is_active", true);

  if (error) throw error;

  const map = new Map<string, Category>();
  for (const row of data ?? []) {
    map.set(String(row.category_name).trim().toLowerCase(), row as Category);
  }
  return map;
}

export async function buildWarrantyRows(bill: Bill) {
  const categories = await loadActiveCategories();

  const { data: existing, error } = await supabaseAdmin
    .from("warranties")
    .select(
      "zoho_line_item_id, unit_index, warranty_number, verification_token, model_number, serial_number, customer_name"
    )
    .eq("bill_number", bill.billNumber)
    .eq("bill_date", bill.billDate);

  if (error) throw error;

  const existingByKey = new Map(
    (existing ?? []).map((w) => [`${w.zoho_line_item_id}#${w.unit_index}`, w])
  );

  const rows: WarrantyRow[] = [];
  const ineligible: IneligibleLine[] = [];

  for (const line of bill.lines) {
    const category = line.categoryName
      ? categories.get(line.categoryName.trim().toLowerCase())
      : undefined;

    if (!category || line.quantity < 1) {
      ineligible.push({
        name: line.name,
        sku: line.sku,
        quantity: line.quantity,
        categoryName: line.categoryName,
      });
      continue;
    }

    for (let unit = 1; unit <= line.quantity; unit++) {
      const key = `${line.lineItemId}#${unit}`;
      const found = existingByKey.get(key);

      rows.push({
        key,
        lineItemId: line.lineItemId,
        itemId: line.itemId,
        unitIndex: unit,
        unitCount: line.quantity,
        productName: line.name,
        sku: line.sku,
        suggestedModel: modelFromName(line.name),
        categoryName: category.category_name,
        standardMonths: category.standard_months,
        extendedAllowed: category.extended_allowed,
        existing: found
          ? {
              warrantyNumber: found.warranty_number,
              token: found.verification_token,
              modelNumber: found.model_number,
              serialNumber: found.serial_number,
              customerName: found.customer_name,
            }
          : null,
      });
    }
  }

  return { rows, ineligible, categoriesConfigured: categories.size > 0 };
}

// Product type words used in Seven Years item names (e.g. "TOTSY JEEP TE6023H").
const TYPE_WORDS = new Set([
  "JEEP", "CAR", "BIKE", "SCOOTER", "RC", "RIDEON", "RIDE-ON", "EV", "PLUS", "BEACH",
]);

/**
 * Best guess of the model number from the Zoho item name:
 * drop the brand (first word) and any product-type words after it.
 *   "TOTSY JEEP TE6023H"      → "TE6023H"
 *   "BAYBEE JEEP MJ117P FM N" → "MJ117P FM N"
 *   "TOYTEK RC RIDEON TT926"  → "TT926"
 * Staff can always edit it.
 */
export function modelFromName(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name.trim();
  let i = 1;
  while (i < words.length - 1 && TYPE_WORDS.has(words[i].toUpperCase())) i++;
  return words.slice(i).join(" ");
}
