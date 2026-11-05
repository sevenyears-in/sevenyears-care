// Service request photos (Supabase Storage, private bucket "service-photos").
// The customer's phone shrinks each photo (~200–300 KB) and uploads it straight
// to storage with a one-time upload link. Photos are deleted for good as soon
// as the request is closed or cancelled.

import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";

export const PHOTO_BUCKET = "service-photos";
export const MAX_PHOTOS = 3;

export { PHOTO_REQUIRED_ISSUES } from "@/lib/site-config";

const DONE = ["closed", "cancelled"];

/** One-time upload links for up to 3 photos (kept under pending/<date>/ until the request is saved). */
export async function createUploadSlots(count: number) {
  const n = Math.max(1, Math.min(MAX_PHOTOS, Math.floor(count)));
  const folder = `pending/${todayISO()}/${randomUUID()}`;
  const slots: { path: string; url: string }[] = [];
  for (let i = 1; i <= n; i++) {
    const path = `${folder}/${i}.jpg`;
    const { data, error } = await supabaseAdmin.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error("Could not prepare the photo upload.");
    slots.push({ path, url: data.signedUrl });
  }
  return slots;
}

/** Move uploaded photos to the request's own folder. Returns the saved paths. */
export async function attachPhotos(requestId: string, paths: unknown): Promise<string[]> {
  const list = (Array.isArray(paths) ? paths : [])
    .map(String)
    .filter((p) => /^pending\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\/[1-3]\.jpg$/.test(p))
    .slice(0, MAX_PHOTOS);
  const saved: string[] = [];
  for (const [i, from] of list.entries()) {
    const to = `${requestId}/${i + 1}.jpg`;
    const { error } = await supabaseAdmin.storage.from(PHOTO_BUCKET).move(from, to);
    if (!error) saved.push(to);
    else console.warn("Photo move failed:", from, error.message);
  }
  if (saved.length) await supabaseAdmin.from("service_requests").update({ photos: saved }).eq("id", requestId);
  return saved;
}

/** Short-lived links for staff to view the photos. */
export async function photoLinks(requestId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("service_requests").select("photos").eq("id", requestId).maybeSingle();
  const paths = ((data?.photos as string[] | null) ?? []).filter(Boolean);
  if (!paths.length) return [];
  const { data: signed } = await supabaseAdmin.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60);
  return ((signed ?? []) as { signedUrl: string | null }[]).map((s) => s.signedUrl).filter((u): u is string => Boolean(u));
}

/**
 * Delete photos of closed / cancelled requests (all, or just the given one),
 * and photos uploaded but never sent (older than 2 days).
 */
export async function purgeServicePhotos(requestId?: string) {
  let query = supabaseAdmin
    .from("service_requests")
    .select("id, photos")
    .in("status", DONE)
    .not("photos", "is", null)
    .limit(200);
  if (requestId) query = query.eq("id", requestId);
  const { data } = await query;
  let removed = 0;
  for (const row of data ?? []) {
    const paths = ((row.photos as string[] | null) ?? []).filter(Boolean);
    if (paths.length) {
      const { error } = await supabaseAdmin.storage.from(PHOTO_BUCKET).remove(paths);
      if (error) {
        console.warn("Photo delete failed:", row.id, error.message);
        continue;
      }
      removed += paths.length;
    }
    await supabaseAdmin.from("service_requests").update({ photos: null }).eq("id", row.id);
  }

  if (!requestId) removed += await purgeAbandonedUploads();
  return removed;
}

async function purgeAbandonedUploads() {
  const cutoff = todayISO(new Date(Date.now() - 2 * 86400_000));
  const storage = supabaseAdmin.storage.from(PHOTO_BUCKET);
  const { data: days } = await storage.list("pending", { limit: 100 });
  let removed = 0;
  for (const day of days ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.name) || day.name >= cutoff) continue;
    const { data: folders } = await storage.list(`pending/${day.name}`, { limit: 1000 });
    const files: string[] = [];
    for (const f of folders ?? []) {
      const { data: inside } = await storage.list(`pending/${day.name}/${f.name}`, { limit: 10 });
      for (const file of inside ?? []) files.push(`pending/${day.name}/${f.name}/${file.name}`);
    }
    if (files.length) {
      await storage.remove(files);
      removed += files.length;
    }
  }
  return removed;
}
