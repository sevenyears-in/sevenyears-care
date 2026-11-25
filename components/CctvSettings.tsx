"use client";

import { useEffect, useState } from "react";
import { ErrorBox, inputClass } from "@/components/SiteChrome";
import { formatDateTime } from "@/lib/helpers";

type Camera = { channel: number | null; name: string; lastAt: string; photo: string | null };
type Link = {
  id: string;
  key: string;
  store: string;
  channels: number[];
  createdAt: string;
  lastEventAt: string | null;
  today: number;
  cameras: Camera[];
  clockOffMin: number | null;
};

type Req = { at: string; method: string; store: string | null; contentType?: string; length?: number | null; userAgent?: string; parts?: string[]; sample?: string; saved?: number; photo?: boolean; error?: string; proto?: string | null; path?: string };

const card = "rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5";

/** Settings → Attendance: each store's VIGI NVR sends "person detected" photos to the app. */
export default function CctvSettings() {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [requests, setRequests] = useState<Req[]>([]);
  const [stores, setStores] = useState<string[]>([]);
  const [store, setStore] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Record<string, number[]>>({});
  const [copied, setCopied] = useState("");
  const host = typeof window === "undefined" ? "care.sevenyears.in" : window.location.host;

  const load = async () => {
    const res = await fetch("/api/staff/admin/cctv", { cache: "no-store" }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) return setError(data.error ?? "Could not load the CCTV links.");
    setLinks(data.links ?? []);
    setRequests(data.requests ?? []);
    setStores(data.stores ?? []);
    setPicked(Object.fromEntries((data.links ?? []).map((l: Link) => [l.id, l.channels])));
  };
  useEffect(() => {
    void load();
  }, []);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/staff/admin/cctv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "Could not save.");
    await load();
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* the text is on screen to copy by hand */
    }
  };

  const free = stores.filter((s) => !(links ?? []).some((l) => l.store === s));

  return (
    <div className={card}>
      <h2 className="text-lg font-bold">CCTV check of opening &amp; closing (TP-Link VIGI)</h2>
      <p className="mt-1 max-w-3xl text-sm text-black/60">
        Each store&apos;s VIGI recorder (NVR) sends a photo every time its camera sees a person. The photos taken just before and after the
        Store Manager&apos;s / ASM&apos;s opening and closing punch show on <b>Store opening &amp; closing</b>, so the Director can see whether it
        was really them. Photos at those punches are kept 90 days; all other photos are deleted after 3 days.
      </p>

      <div className="mt-5 space-y-5">
        {(links ?? []).map((l) => {
          const path = `/api/cctv/vigi/${l.key}`;
          const live = l.lastEventAt && Date.now() - Date.parse(l.lastEventAt) < 24 * 3_600_000;
          const chosen = picked[l.id] ?? [];
          const changed = JSON.stringify([...chosen].sort()) !== JSON.stringify([...l.channels].sort());
          return (
            <div key={l.id} className="rounded-2xl p-4 ring-1 ring-black/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-bold">{l.store}</h3>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${live ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800"}`}>
                  {l.lastEventAt ? `Last photo ${formatDateTime(l.lastEventAt)} · ${l.today} today` : "Waiting for the NVR — nothing received yet"}
                </span>
              </div>

              <p className="mt-3 text-xs font-bold uppercase tracking-wider text-black/45">On the NVR: Settings → Event → Alarm Server → + Add</p>
              <table className="mt-1 text-sm">
                <tbody>
                  {[
                    ["Host IP / Domain", host],
                    ["URL", path],
                    ["Protocol", "HTTP"],
                    ["Port", "80"],
                    ["Attach image", "On (tick)"],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-0.5 pr-4 text-black/55">{k}</td>
                      <td className="py-0.5 font-mono text-[13px]">
                        {v}
                        {(k === "URL" || k === "Host IP / Domain") && (
                          <button type="button" onClick={() => copy(v, `${l.id}${k}`)} className="ml-2 rounded-md bg-black/5 px-1.5 py-0.5 font-sans text-[11px] font-semibold">
                            {copied === `${l.id}${k}` ? "Copied" : "Copy"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-black/50">Keep the URL private: anyone with it can send photos to this store.</p>
              {l.clockOffMin !== null && Math.abs(l.clockOffMin) >= 2 && (
                <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  The NVR&apos;s clock is {Math.abs(l.clockOffMin)} minute(s) {l.clockOffMin > 0 ? "fast" : "slow"}. Set its time to update automatically (NTP), and check the
                  punching machine&apos;s clock too, so photos line up with punches.
                </p>
              )}

              {l.cameras.length > 0 && (
                <>
                  <p className="mt-4 text-sm font-semibold">Which camera faces the staff entrance?</p>
                  <p className="text-xs text-black/50">Tick it. Photos from other cameras are then not kept. Nothing ticked = every camera.</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {l.cameras.map((c) => {
                      const on = c.channel !== null && chosen.includes(c.channel);
                      return (
                        <label key={String(c.channel)} className={`block w-44 cursor-pointer rounded-xl p-2 ring-1 ${on ? "ring-2 ring-[#8883d7]" : "ring-black/10"}`}>
                          {c.photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.photo} alt={c.name} className="h-24 w-full rounded-lg object-cover" />
                          ) : (
                            <span className="flex h-24 items-center justify-center rounded-lg bg-black/5 text-xs text-black/40">No photo</span>
                          )}
                          <span className="mt-1.5 flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={c.channel === null}
                              onChange={(e) =>
                                setPicked((p) => ({ ...p, [l.id]: e.target.checked ? [...chosen, c.channel!] : chosen.filter((x) => x !== c.channel) }))
                              }
                            />
                            <span className="truncate font-semibold">{c.name}</span>
                          </span>
                          <span className="block text-[11px] text-black/45">Last {formatDateTime(c.lastAt)}</span>
                        </label>
                      );
                    })}
                  </div>
                  {changed && (
                    <button type="button" disabled={busy} onClick={() => post({ action: "channels", id: l.id, channels: chosen })} className="mt-3 rounded-xl bg-[#161616] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                      Save cameras
                    </button>
                  )}
                </>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Remove the CCTV link of ${l.store}? Its NVR can no longer send photos (photos already received stay).`)) void post({ action: "remove", id: l.id });
                }}
                className="mt-4 block text-xs font-semibold text-red-700 underline"
              >
                Remove this link
              </button>
            </div>
          );
        })}
      </div>

      {links && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <select value={store} onChange={(e) => setStore(e.target.value)} className={`${inputClass} w-56`}>
            <option value="">Choose a store…</option>
            {free.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy || !store} onClick={() => post({ action: "add", store }).then(() => setStore(""))} className="rounded-xl bg-[#161616] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
            Create link for this store&apos;s NVR
          </button>
        </div>
      )}
      <ErrorBox message={error} />

      <details className="mt-5 text-sm">
        <summary className="cursor-pointer font-semibold text-black/60">What the recorders sent ({requests.length}, newest first)</summary>
        {requests.length === 0 ? (
          <p className="mt-2 text-black/50">Nothing has reached the app from any recorder yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {requests.map((r, i) => (
              <li key={i} className={`rounded-xl p-3 ring-1 ${r.error ? "bg-red-50 ring-red-100" : "bg-black/[0.02] ring-black/5"}`}>
                <div className="flex flex-wrap gap-x-3 text-xs">
                  <b>{formatDateTime(r.at)}</b>
                  <span>{r.store ?? "unknown link"}</span>
                  <span>{r.method}</span>
                  {r.contentType && <span className="text-black/50">{r.contentType}</span>}
                  {r.proto && <span className="text-black/50">{r.proto.toUpperCase()}</span>}
                  {r.userAgent && <span className="text-black/40">{r.userAgent.slice(0, 40)}</span>}
                  {typeof r.saved === "number" && <span className="font-semibold text-green-700">saved {r.saved}{r.photo ? " + photo" : ""}</span>}
                  {r.error && <span className="font-semibold text-red-700">{r.error}</span>}
                </div>
                {r.path && <p className="mt-1 font-mono text-[11px] text-black/45">{r.path}</p>}
                {r.parts && r.parts.length > 0 && <p className="mt-1 text-[11px] text-black/50">Parts: {r.parts.join(", ")}</p>}
                {r.sample && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[11px] text-black/60">{r.sample}</pre>}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
