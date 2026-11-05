"use client";

import { useEffect, useRef, useState } from "react";

// Up to 3 photos from the camera or gallery (works in the installed app too).
// Each photo is shrunk on the phone to about 200–300 KB before upload.

export type PickedPhoto = { id: string; blob: Blob; preview: string };

const MAX_SIDE = 1600;
const QUALITY = 0.75;

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  let width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void;
  if (bitmap) {
    width = bitmap.width;
    height = bitmap.height;
    draw = (ctx) => ctx.drawImage(bitmap, 0, 0, w, h);
  } else {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    width = img.naturalWidth;
    height = img.naturalHeight;
    draw = (ctx) => ctx.drawImage(img, 0, 0, w, h);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  draw(ctx);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", QUALITY)
  );
}

export function PhotoPicker({
  photos,
  onChange,
  max = 3,
  required,
}: {
  photos: PickedPhoto[];
  onChange: (p: PickedPhoto[]) => void;
  max?: number;
  required: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    setBusy(true);
    const next = [...photos];
    for (const file of Array.from(files)) {
      if (next.length >= max) break;
      if (!file.type.startsWith("image/")) continue;
      try {
        const blob = await shrink(file);
        next.push({ id: `${Date.now()}-${Math.random()}`, blob, preview: URL.createObjectURL(blob) });
      } catch {
        setError("One photo could not be read. Please try another.");
      }
    }
    onChange(next);
    setBusy(false);
    if (input.current) input.current.value = "";
  };

  const remove = (id: string) => {
    const p = photos.find((x) => x.id === id);
    if (p) URL.revokeObjectURL(p.preview);
    onChange(photos.filter((x) => x.id !== id));
  };

  return (
    <div>
      <p className="mb-2 text-sm font-semibold">
        Photos {required ? `* (${max} photos from different angles)` : "(optional, up to 3)"}
      </p>
      <div className="flex flex-wrap gap-3">
        {photos.map((p) => (
          <div key={p.id} className="relative h-24 w-24 overflow-hidden rounded-2xl ring-1 ring-black/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.preview} alt="Product photo" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => remove(p.id)}
              aria-label="Remove photo"
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white"
            >
              ✕
            </button>
          </div>
        ))}
        {photos.length < max && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="flex h-24 w-24 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-black/15 text-xs font-semibold text-black/55 hover:border-[#11b8d0] hover:text-[#0b7f90] disabled:opacity-50"
          >
            <span className="text-2xl">{busy ? "…" : "📷"}</span>
            {busy ? "Preparing" : "Add photo"}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => add(e.target.files)}
      />
      {required && (
        <p className="mt-2 text-xs text-black/50">Take the full product from the front, from the side, and a close-up of the problem.</p>
      )}
      {error && <p className="mt-2 text-xs text-[#d43852]">{error}</p>}
    </div>
  );
}

/** Uploads the photos straight to storage; returns their saved paths. */
export async function uploadPhotos(photos: PickedPhoto[]): Promise<string[]> {
  if (!photos.length) return [];
  const res = await fetch("/api/service-requests/photos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count: photos.length }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Photo upload is not available right now.");
  const slots = (data.slots ?? []) as { path: string; url: string }[];
  await Promise.all(
    slots.map(async (slot, i) => {
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", photos[i].blob, `${i + 1}.jpg`);
      const up = await fetch(slot.url, { method: "PUT", body: form, headers: { "x-upsert": "false" } });
      if (!up.ok) throw new Error("A photo could not be uploaded. Please check your internet and try again.");
    })
  );
  return slots.map((s) => s.path);
}
