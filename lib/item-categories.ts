// Item categories when Zoho POS has none (server only).
//
// Items in the new Zoho organisation (Seven Years Kids Care LLP) were created without a
// category, and Zoho then gives the item's own name as its "group". Categories decide warranty
// eligibility, carry bags, category counts and the stock / merchandise pages, so:
//   1. a category that is just the item's own name is not a category;
//   2. a missing category is taken from the same SKU (then the same name) in the earlier
//      organisation, whose items all have one. That list is read from Zoho once and kept in
//      app_settings ("item_categories"); it is read again after 7 days.

import { supabaseAdmin } from "@/lib/supabase/server";
import { loadZohoSettings, previousZohoOrgs, withZohoOrg, zohoRead } from "@/lib/zoho";

type Obj = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const key = (v: unknown) => str(v).replace(/\s+/g, " ").toUpperCase();

const SETTINGS_KEY = "item_categories";
const MAX_AGE_MS = 7 * 86_400_000;

/** The category, unless it is empty or only the item's own name. */
export function realCategory(category: unknown, name: unknown): string {
  const c = str(category);
  if (!c) return "";
  return key(c) === key(name) ? "" : c;
}

type Saved = { org: string; builtAt: string; bySku: Record<string, string>; byName: Record<string, string> };

let cached: { at: number; value: Saved | null } | null = null;
let building: Promise<Saved | null> | null = null;

async function readSaved(): Promise<Saved | null> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
  const v = data?.value as Saved | null;
  return v && v.bySku && v.byName ? v : null;
}

/** Reads every item of an earlier organisation (200 a request) and keeps SKU / name → category. */
async function build(org: string): Promise<Saved | null> {
  const bySku: Record<string, string> = {};
  const byName: Record<string, string> = {};
  await withZohoOrg(org, async () => {
    for (let page = 1; page <= 200; page++) {
      const res = await zohoRead("items", { per_page: "200", page: String(page) });
      for (const i of arr(res.items)) {
        const cat = realCategory(i.category_name, i.name);
        if (!cat) continue;
        const sku = key(i.sku);
        const name = key(i.name);
        if (sku && !bySku[sku]) bySku[sku] = cat;
        if (name && !byName[name]) byName[name] = cat;
      }
      if (!(res.page_context as Obj | undefined)?.has_more_page) break;
    }
  });
  if (!Object.keys(bySku).length && !Object.keys(byName).length) return null;
  const value: Saved = { org, builtAt: new Date().toISOString(), bySku, byName };
  await supabaseAdmin.from("app_settings").upsert({ key: SETTINGS_KEY, value, updated_at: value.builtAt });
  return value;
}

async function load(): Promise<Saved | null> {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
  let value = await readSaved().catch(() => null);
  const prev = previousZohoOrgs(await loadZohoSettings())[0];
  const stale = !value || (prev && value.org !== prev.id) || Date.now() - Date.parse(value.builtAt) > MAX_AGE_MS;
  if (prev && stale) {
    building ??= build(prev.id)
      .catch((e) => {
        console.warn("Item categories from the earlier Zoho organisation could not be read:", e);
        return null;
      })
      .finally(() => (building = null));
    value = (await building) ?? value;
  }
  cached = { at: Date.now(), value };
  return value;
}

/** Looks up categories for items with none: by SKU, then by name. Unknown → "". */
export async function categoryLookup(): Promise<(sku: unknown, name: unknown) => string> {
  const saved = await load().catch(() => null);
  return (sku, name) => (saved ? saved.bySku[key(sku)] || saved.byName[key(name)] || "" : "");
}
