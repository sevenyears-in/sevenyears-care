"use client";

import { useState } from "react";
import { cardClass, ErrorBox, inputClass, primaryButtonClass } from "@/components/SiteChrome";
import {
  COMPLAINT_RESOLVED_QUESTION,
  NOT_APPLICABLE,
  STAR_LABELS,
  type FeedbackFormKind,
  type FeedbackQuestion,
} from "@/lib/feedback-forms";

export function FeedbackForm({
  token,
  kind,
  questions,
  needsConfirmation,
  canRate,
  alreadyDone,
  canShare = false,
  defaultName = "",
}: {
  token: string;
  kind: FeedbackFormKind;
  questions: FeedbackQuestion[];
  needsConfirmation: boolean;
  canRate: boolean;
  alreadyDone: boolean;
  canShare?: boolean;
  defaultName?: string;
}) {
  const [share, setShare] = useState(false);
  const [displayName, setDisplayName] = useState(defaultName);
  const [confirmed, setConfirmed] = useState<string | null>(needsConfirmation ? null : "done");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [thanks, setThanks] = useState(alreadyDone ? "You have already shared your feedback. Thank you!" : "");

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: decodeURIComponent(token), ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return null;
      }
      return String(data.message ?? "Thank you!");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(value: string) {
    const msg = await post({ confirm: value });
    if (msg) {
      setConfirmed(value);
      setConfirmMessage(msg);
    }
  }

  async function submit() {
    for (const q of questions) {
      if (q.type !== "comment" && answers[q.id] === undefined) {
        setError(`Please answer: ${q.label}`);
        return;
      }
    }
    const msg = await post({ answers, publicConsent: canShare && share, displayName: canShare && share ? displayName : "" });
    if (msg) setThanks(msg);
  }

  return (
    <div className="space-y-6">
      {kind === "complaint" && confirmed === null && (
        <div className={cardClass}>
          <h2 className="text-lg font-bold">{COMPLAINT_RESOLVED_QUESTION.label}</h2>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {COMPLAINT_RESOLVED_QUESTION.options.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={busy}
                onClick={() => confirm(o.value)}
                className={`rounded-2xl border px-4 py-4 text-base font-bold transition disabled:opacity-50 ${
                  o.value === "yes"
                    ? "border-green-600 bg-green-600 text-white"
                    : "border-black/10 bg-white hover:border-[#ff5e79]"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <ErrorBox message={error} />
        </div>
      )}

      {confirmMessage && (
        <div className="rounded-2xl border border-green-600/20 bg-green-50 p-4 text-sm font-semibold text-green-800">
          {confirmMessage}
        </div>
      )}

      {thanks ? (
        <div className={cardClass}>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl">✓</div>
          <p className="mt-4 text-lg font-bold">{thanks}</p>
        </div>
      ) : (
        !canRate && confirmed !== null ? (
          <div className={cardClass}>
            <p className="text-black/70">
              {kind === "complaint" ? "You can rate us once your complaint is resolved." : "You can rate the service once the work is completed."}
            </p>
          </div>
        ) : (
        confirmed !== null && (
          <div className={cardClass}>
            {kind === "complaint" && <h2 className="mb-1 text-lg font-bold">Rate how we handled it</h2>}
            <p className="mb-6 text-xs text-black/50">1 Very poor · 2 Poor · 3 Average · 4 Good · 5 Excellent</p>
            <div className="space-y-7">
              {questions.map((q) => (
                <div key={q.id}>
                  <p className="mb-3 font-semibold">
                    {q.label}
                    {q.type === "comment" && <span className="font-normal text-black/40"> (optional)</span>}
                  </p>
                  {q.type === "stars" && (
                    <Stars value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
                  )}
                  {q.type === "choice" && (
                    <div className="flex flex-wrap gap-2">
                      {q.options.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.value }))}
                          className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                            answers[q.id] === o.value
                              ? "border-[#ff5e79] bg-[#ff5e79] text-white"
                              : "border-black/10 bg-white"
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {q.type === "comment" && (
                    <textarea
                      rows={3}
                      maxLength={2000}
                      className={inputClass}
                      value={String(answers[q.id] ?? "")}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
            {canShare && (
              <div className="mt-7 rounded-2xl bg-[#f7f9fb] p-4 ring-1 ring-black/5">
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-1 h-5 w-5 accent-[#8883d7]" />
                  <span className="text-sm">
                    <span className="font-semibold">You may share my review on sevenyears.in</span>
                    <span className="block text-xs text-black/50">
                      Only a summary of your ratings and comment is shown — never your phone number. Reviews with a 4 or 5 star overall rating are shown.
                    </span>
                  </span>
                </label>
                {share && (
                  <label className="mt-3 block">
                    <span className="mb-1.5 block text-xs font-bold text-black/60">Name to show (optional)</span>
                    <input
                      value={displayName}
                      maxLength={40}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className={inputClass}
                      placeholder="e.g. Fathima"
                    />
                  </label>
                )}
              </div>
            )}
            <ErrorBox message={confirmed === null ? "" : error} />
            <button type="button" disabled={busy} onClick={submit} className={`${primaryButtonClass} mt-8`}>
              {busy ? "Sending…" : "Send feedback"}
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function Stars({ value, onChange }: { value: string | number | undefined; onChange: (v: number | string) => void }) {
  const n = typeof value === "number" ? value : 0;
  return (
    <div>
      <div className="flex items-center gap-1" role="radiogroup">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={n === i}
            aria-label={`${i} ${STAR_LABELS[i - 1]}`}
            onClick={() => onChange(i)}
            className={`text-4xl leading-none transition ${i <= n ? "text-amber-400" : "text-black/15"}`}
          >
            ★
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(NOT_APPLICABLE)}
          className={`ml-3 rounded-full border px-3 py-1 text-xs font-semibold ${
            value === NOT_APPLICABLE ? "border-[#161616] bg-[#161616] text-white" : "border-black/10 text-black/60"
          }`}
        >
          Not applicable
        </button>
      </div>
      <p className="mt-1 h-4 text-xs text-black/50">{n ? `${n} · ${STAR_LABELS[n - 1]}` : value === NOT_APPLICABLE ? "Not applicable" : ""}</p>
    </div>
  );
}
