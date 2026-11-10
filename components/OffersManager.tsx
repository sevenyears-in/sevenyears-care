"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { RichText } from "@/components/RichText";

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
  const [audience, setAudience] = useState<"all" | "selected">("all");
  const [mobiles, setMobiles] = useState("");
  const [whatsapp, setWhatsapp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  /** Wrap the selected words in ** (bold) or _ (italic). */
  const wrap = (mark: string, sample: string) => {
    const el = box.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const picked = message.slice(a, b) || sample;
    const next = message.slice(0, a) + mark + picked + mark + message.slice(b);
    setMessage(next.slice(0, 1000));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + mark.length, a + mark.length + picked.length);
    });
  };

  const send = async () => {
    const who = audience === "all" ? "everyone" : "the customers you listed";
    if (!confirm(`Send this offer to ${who}${whatsapp ? " — in the app AND on WhatsApp (Meta charges about ₹0.80 per WhatsApp message)" : ""}?`)) return;
    setBusy(true);
    setNote(null);
    const { ok, data } = await post({ action: "send", title, message, link, validUntil, audience, mobiles, whatsapp });
    setBusy(false);
    if (!ok) return setNote({ ok: false, text: data.error || "Could not send." });
    setNote({ ok: data.sent, text: data.sent ? data.note || "Sent! Customers will get the notification in a few seconds." : data.warning });
    setMobiles("");
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
          <span className={label}>Message — press Enter for a new line</span>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => wrap("**", "bold text")} className="rounded-lg bg-[#f7f9fb] px-3 py-1 text-sm font-black ring-1 ring-black/10 hover:bg-white" title="Bold">
              B
            </button>
            <button type="button" onClick={() => wrap("_", "italic text")} className="rounded-lg bg-[#f7f9fb] px-3 py-1 text-sm italic ring-1 ring-black/10 hover:bg-white" title="Italic">
              I
            </button>
            <span className="text-xs text-black/45">Select words, then tap B or I</span>
          </div>
          <textarea
            ref={box}
            value={message}
            maxLength={1000}
            rows={6}
            onChange={(e) => setMessage(e.target.value)}
            className={input}
            placeholder={"e.g. 🎉 **FLASH OFFER — 50% OFF!**\nFirst 5 customers only, 3 PM – 4 PM today."}
          />
        </label>
        {message.trim() && (
          <div className="rounded-2xl bg-[#f7f9fb] p-4 ring-1 ring-black/5">
            <p className="text-xs font-bold uppercase tracking-wide text-black/40">Preview</p>
            {title && <p className="mt-1 font-bold">{title}</p>}
            <p className="mt-1 text-sm leading-6 text-black/70">
              <RichText text={message} />
            </p>
            <p className="mt-2 text-[11px] text-black/40">Phone notifications show the text without bold / italic.</p>
          </div>
        )}
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
        <div>
          <span className={label}>Send to</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "📣 All customers with the app"],
                ["selected", "🎯 Chosen customers"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setAudience(v)}
                className={`rounded-full px-4 py-2 text-sm font-bold ${audience === v ? "bg-[#161616] text-white" : "bg-white ring-1 ring-black/10"}`}
              >
                {l}
              </button>
            ))}
          </div>
          {audience === "selected" && (
            <textarea
              value={mobiles}
              onChange={(e) => setMobiles(e.target.value)}
              rows={3}
              className={`${input} mt-3`}
              placeholder="Customer mobile numbers — one per line or separated by commas"
            />
          )}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} className="h-5 w-5 accent-[#25D366]" />
          Also send on WhatsApp <span className="font-normal text-black/45">(reaches customers without the app · paid per message)</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={send} disabled={busy} className="rounded-2xl bg-[#ff5e79] px-6 py-3 text-sm font-bold text-white disabled:opacity-50">
            {busy ? "Sending…" : audience === "all" ? "📣 Send to all customers" : "🎯 Send to these customers"}
          </button>
          {note && <p className={`text-sm font-semibold ${note.ok ? "text-green-700" : "text-amber-800"}`}>{note.text}</p>}
        </div>
      </div>
    </section>
  );
}

export function DeleteOfferButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Delete this offer? It will be removed from the Offers page. This cannot be undone.")) return;
        setBusy(true);
        const { ok, data } = await post({ action: "delete", id });
        if (!ok) alert(data.error || "Could not delete.");
        router.refresh();
      }}
      className="font-bold text-black/50 hover:text-[#d43852] disabled:opacity-50"
    >
      {busy ? "…" : "🗑 Delete"}
    </button>
  );
}

type Wishes = { enabled: boolean; whatsapp: boolean; child: string; father: string; mother: string; anniversary: string };

/** Automatic birthday & anniversary wishes. */
export function WishesSettings({ initial }: { initial: Wishes }) {
  const [w, setW] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const field = (key: keyof Omit<Wishes, "enabled" | "whatsapp">, title: string, hint: string) => (
    <label className="block">
      <span className={label}>
        {title} <span className="font-normal text-black/40">{hint}</span>
      </span>
      <textarea value={w[key]} rows={2} maxLength={300} onChange={(e) => setW({ ...w, [key]: e.target.value })} className={input} />
    </label>
  );
  return (
    <section className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">🎂 Automatic wishes</h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={w.enabled} onChange={(e) => setW({ ...w, enabled: e.target.checked })} className="h-5 w-5 accent-[#8883d7]" />
          {w.enabled ? "On" : "Off"}
        </label>
      </div>
      <p className="mt-1 text-sm text-black/55">
        Sent automatically at 8 am on the day, to customers who saved these dates (at warranty registration or in My Account) — as an app
        notification, and on WhatsApp when switched on below.
      </p>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={w.whatsapp} onChange={(e) => setW({ ...w, whatsapp: e.target.checked })} className="h-5 w-5 accent-[#25D366]" />
        Also send on WhatsApp <span className="font-normal text-black/45">(uses the approved WhatsApp greeting templates — their wording is fixed)</span>
      </label>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {field("child", "Child's birthday", "— {child} = child's name")}
        {field("anniversary", "Wedding anniversary", "")}
        {field("father", "Father's birthday", "")}
        {field("mother", "Mother's birthday", "")}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setNote("");
            const { ok, data } = await post({ action: "wishes", settings: w });
            setBusy(false);
            setNote(ok ? "Saved." : data.error || "Could not save.");
          }}
          className="rounded-2xl bg-[#8883d7] px-6 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save wishes"}
        </button>
        {note && <p className="text-sm font-semibold text-green-700">{note}</p>}
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

export function ResendOfferButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Send this offer's notification again to the same people?")) return;
        setBusy(true);
        const { ok, data } = await post({ action: "resend", id });
        setBusy(false);
        alert(ok ? data.note || data.warning || "Sent again." : data.error || "Could not resend.");
        router.refresh();
      }}
      className="font-bold text-[#8883d7] hover:underline disabled:opacity-50"
    >
      {busy ? "Sending…" : "🔁 Resend"}
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

/** Approver: approve (shows and sends the offer) or reject it. */
export function ApproveOfferButtons({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(action: "approve" | "reject") {
    if (!confirm(action === "approve" ? "Approve this offer? Customers will see it and get the notification now." : "Reject this offer? Customers will not see it.")) return;
    setBusy(true);
    const { ok, data } = await post({ action, id });
    setBusy(false);
    alert(ok ? data.note || data.warning || "Done." : data.error || "Could not save.");
    router.refresh();
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => act("approve")} className="rounded-full bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50">
        {busy ? "Saving…" : "✓ Approve & send"}
      </button>
      <button type="button" disabled={busy} onClick={() => act("reject")} className="rounded-full bg-white px-4 py-2 text-sm font-bold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50">
        ✕ Reject
      </button>
    </div>
  );
}
