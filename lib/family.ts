import { supabaseAdmin } from "@/lib/supabase/server";

// Family dates kept for each customer (by mobile number) — used for birthday/anniversary wishes and offers.

import { EMPTY_FAMILY, MAX_CHILDREN, type Child, type FamilyDates } from "@/lib/family-types";
export { EMPTY_FAMILY, MAX_CHILDREN, type Child, type FamilyDates };

const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Clean what the browser sent. Returns an error message for bad dates. */
export function cleanFamily(input: unknown): { ok: true; value: FamilyDates } | { ok: false; error: string } {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);
  const date = (v: unknown, label: string, allowFuture = false): string | { error: string } => {
    const s = String(v ?? "").trim();
    if (!s) return "";
    if (!isDate(s)) return { error: `${label}: enter a valid date.` };
    if (!allowFuture && s > today) return { error: `${label} can't be in the future.` };
    if (s < "1900-01-01") return { error: `${label}: enter a valid date.` };
    return s;
  };
  const children: Child[] = [];
  const list = Array.isArray(raw.children) ? raw.children.slice(0, MAX_CHILDREN) : [];
  for (const [i, c] of list.entries()) {
    const child = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const name = String(child.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    // Expected dates allowed for a baby on the way (up to 10 months ahead).
    const dob = date(child.dob, `Child ${i + 1}'s birthday`, true);
    if (typeof dob !== "string") return { ok: false, error: dob.error };
    if (dob && dob > new Date(Date.now() + 300 * 86400_000).toISOString().slice(0, 10))
      return { ok: false, error: `Child ${i + 1}'s birthday is too far in the future.` };
    if (!name && !dob) continue;
    if (!dob) return { ok: false, error: `Enter ${name || `child ${i + 1}`}'s birthday.` };
    children.push({ name, dob });
  }
  const fatherDob = date(raw.fatherDob, "Father's birthday");
  if (typeof fatherDob !== "string") return { ok: false, error: fatherDob.error };
  const motherDob = date(raw.motherDob, "Mother's birthday");
  if (typeof motherDob !== "string") return { ok: false, error: motherDob.error };
  const anniversary = date(raw.anniversary, "Wedding anniversary");
  if (typeof anniversary !== "string") return { ok: false, error: anniversary.error };
  return { ok: true, value: { children, fatherDob, motherDob, anniversary } };
}

export const familyIsEmpty = (f: FamilyDates) => f.children.length === 0 && !f.fatherDob && !f.motherDob && !f.anniversary;

export async function loadFamily(mobile: string): Promise<FamilyDates> {
  const { data, error } = await supabaseAdmin.from("customer_family").select("*").eq("mobile", mobile).maybeSingle();
  if (error || !data) return { ...EMPTY_FAMILY };
  return {
    children: (Array.isArray(data.children) ? data.children : []).map((c: Child) => ({ name: String(c.name ?? ""), dob: String(c.dob ?? "") })),
    fatherDob: data.father_dob ?? "",
    motherDob: data.mother_dob ?? "",
    anniversary: data.anniversary ?? "",
  };
}

/**
 * Save family dates. With merge (staff at registration) only filled-in values are added,
 * so details the customer entered themselves are never wiped.
 */
export async function saveFamily(mobile: string, next: FamilyDates, by: string, merge = false) {
  let value = next;
  if (merge) {
    const current = await loadFamily(mobile);
    const kids = [...current.children];
    for (const c of next.children) {
      if (!kids.some((k) => k.dob === c.dob && k.name.toLowerCase() === c.name.toLowerCase())) kids.push(c);
    }
    value = {
      children: kids.slice(0, MAX_CHILDREN),
      fatherDob: next.fatherDob || current.fatherDob,
      motherDob: next.motherDob || current.motherDob,
      anniversary: next.anniversary || current.anniversary,
    };
  }
  const { error } = await supabaseAdmin.from("customer_family").upsert({
    mobile,
    children: value.children,
    father_dob: value.fatherDob || null,
    mother_dob: value.motherDob || null,
    anniversary: value.anniversary || null,
    updated_by: by,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return value;
}
