"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/helpers";

type Explanation = {
  id: string;
  staffId: string;
  staffName: string;
  reason: string;
  requestedByName: string | null;
  requestedAt: string;
  explanation: string | null;
  explainedAt: string | null;
};

type Props = {
  type: "service" | "complaint";
  ticketId: string;
  currentStaffId: string;
  canAsk: boolean;
  explanations: Explanation[];
  people: { id: string; label: string }[];
  suggestedStaffId: string | null;
};

const box = "w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-[#ff5e79]";

export function ExplanationsPanel({ type, ticketId, currentStaffId, canAsk, explanations, people, suggestedStaffId }: Props) {
  const router = useRouter();
  const [staffId, setStaffId] = useState(
    suggestedStaffId && people.some((p) => p.id === suggestedStaffId) ? suggestedStaffId : ""
  );
  const [reason, setReason] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  if (!canAsk && explanations.length === 0) return null;

  const send = async (method: "POST" | "PATCH", body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/staff/explanations", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) {
      setError(data.error ?? "Unable to save.");
      return false;
    }
    setNotice(success);
    router.refresh();
    return true;
  };

  return (
    <div className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6">
      <h2 className="text-lg font-bold">Staff explanations</h2>
      <p className="mt-1 text-xs text-black/50">Staff only — the customer does not see these.</p>

      {explanations.length > 0 && (
        <ul className="mt-4 space-y-3">
          {explanations.map((e) => {
            const mine = e.staffId === currentStaffId && !e.explainedAt;
            return (
              <li key={e.id} className={`rounded-2xl p-4 text-sm ${mine ? "bg-amber-50 ring-1 ring-amber-200" : "bg-[#f7f9fb]"}`}>
                <p className="font-bold">
                  {e.staffName}
                  {!e.explainedAt && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">Waiting</span>}
                </p>
                <p className="mt-1 text-black/70">
                  <span className="font-semibold">Asked:</span> {e.reason}
                </p>
                <p className="text-xs text-black/45">
                  {e.requestedByName ?? "System"} · {formatDateTime(e.requestedAt)}
                </p>
                {e.explanation && (
                  <div className="mt-3 rounded-xl bg-white p-3">
                    <p className="whitespace-pre-line">{e.explanation}</p>
                    <p className="mt-1 text-xs text-black/45">Replied {formatDateTime(e.explainedAt)}</p>
                  </div>
                )}
                {mine && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      rows={4}
                      maxLength={4000}
                      value={answers[e.id] ?? ""}
                      onChange={(ev) => setAnswers((a) => ({ ...a, [e.id]: ev.target.value }))}
                      className={box}
                      placeholder="Your explanation — what happened, from your side."
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => send("PATCH", { id: e.id, explanation: answers[e.id] ?? "" }, "Your explanation has been sent.")}
                      className="rounded-xl bg-[#161616] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      Send my explanation
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canAsk && (
        <div className="mt-5 space-y-2 rounded-2xl border border-black/10 p-4">
          <p className="text-sm font-bold">Ask someone to explain</p>
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={box} aria-label="Staff member">
            <option value="">Choose a staff member</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <textarea
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={box}
            placeholder="What should they explain? e.g. Not acknowledged within 2 hours / customer says they were rude."
          />
          <button
            type="button"
            disabled={busy || !staffId || reason.trim().length < 5}
            onClick={async () => {
              const ok = await send("POST", { type, ticketId, staffId, reason }, "Request sent. They have been alerted.");
              if (ok) setReason("");
            }}
            className="rounded-xl bg-[#ff5e79] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            Ask for explanation
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      {notice && <p className="mt-3 text-sm font-semibold text-green-700">{notice}</p>}
    </div>
  );
}
