"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const input =
  "w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-[#8883d7] focus:ring-2 focus:ring-[#8883d7]/20";
const label = "mb-1.5 block text-xs font-bold text-black/60";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/staff/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/** New offer form. */
export function OffersManager() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    if (!confirm("Send this offer to everyone who has the app?")) return;
    setBusy(true);
    setNote(null);
    const { ok, data } = await post({ action: "send", title, message, link, validUntil });
    setBusy(false);
    if (!ok) return setNote({ ok: false, text: data.error || "Could not send." });
    setNote({ ok: data.sent, text: data.sent ? "Sent! Customers will get the notification in a few seconds." : data.warning });
    setTitle("");
    setMessage("");
    setLink("");
    setValidUntil("");
    router.refresh();
  };

  return (
    <section className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6">
      <h2 className="text-lg font-bold">New offer</h2>
      <div className="mt-4 space-y-4">
        <label className="block">
          <span className={label}>Title (shown in bold on the phone)</span>
          <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className={input} placeholder="e.g. Weekend Sale — 20% off strollers" />
        </label>
        <label className="block">
          <span className={label}>Message</span>
          <textarea value={message} maxLength={400} rows={3} onChange={(e) => setMessage(e.target.value)} className={input} placeholder="e.g. This Saturday and Sunday at all Seven Years stores." />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Last date (optional)</span>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={input} />
          </label>
          <label className="block">
            <span className={label}>Link (optional, https://…)</span>
            <input value={link} onChange={(e) => setLink(e.target.value)} className={input} placeholder="https://sevenyears.in/…" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={send} disabled={busy} className="rounded-2xl bg-[#ff5e79] px-6 py-3 text-sm font-bold text-white disabled:opacity-50">
            {busy ? "Sending…" : "📣 Send to all customers"}
          </button>
          {note && <p className={`text-sm font-semibold ${note.ok ? "text-green-700" : "text-amber-800"}`}>{note.text}</p>}
        </div>
      </div>
    </section>
  );
}

export function StopOfferButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await post({ action: "stop", id });
        router.refresh();
      }}
      className="font-bold text-[#d43852] hover:underline disabled:opacity-50"
    >
      {busy ? "…" : "Hide offer"}
    </button>
  );
}

/** Super Admin: paste the Firebase key file once. */
export function PushSetup() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="rounded-3xl border border-amber-300 bg-amber-50 p-5 sm:p-6">
      <h2 className="font-bold">Switch on phone notifications (one time)</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-black/70">
        <li>Open console.firebase.google.com → your “Seven years” project → ⚙️ Project settings → <b>Service accounts</b>.</li>
        <li>Click <b>Generate new private key</b> → Generate key. A .json file downloads.</li>
        <li>Open that file with Notepad, select all, copy, and paste it below. Then delete the file from Downloads.</li>
      </ol>
      <textarea value={key} onChange={(e) => setKey(e.target.value)} rows={4} className={`${input} mt-3 font-mono text-xs`} placeholder='{ "type": "service_account", … }' />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !key.trim()}
          onClick={async () => {
            setBusy(true);
            setError("");
            const { ok, data } = await post({ action: "setup", key });
            setBusy(false);
            if (!ok) return setError(data.error || "Could not save.");
            setKey("");
            router.refresh();
          }}
          className="rounded-2xl bg-[#161616] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Checking…" : "Save and switch on"}
        </button>
        {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
      </div>
    </section>
  );
}
