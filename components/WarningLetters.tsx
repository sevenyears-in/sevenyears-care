"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const box = "w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-[#ff5e79]";
const pinkBtn = "rounded-full bg-[#ff5e79] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const plainBtn = "rounded-full bg-black/5 px-5 py-2.5 text-sm font-bold text-black/70 disabled:opacity-50";

type Person = { id: string; userId: string; name: string; store: string | null; designation: string };

async function call(url: string, method: "GET" | "POST", body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  const data = response ? await response.json().catch(() => ({})) : {};
  if (!response?.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}

const lastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Write a new warning letter (template filled in from the records, all editable). */
export function NewLetterForm({
  people,
  kinds,
  direct,
  start,
}: {
  people: Person[];
  kinds: Record<string, string>;
  direct: boolean;
  /** Opened from a record in Care (e.g. an SOP violation): the person, reason and month to start with. */
  start?: { staffId: string; kind: string; month?: string } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(start));
  const [query, setQuery] = useState("");
  const [staffId, setStaffId] = useState(start?.staffId ?? "");
  const [kind, setKind] = useState("");
  const [month, setMonth] = useState(start?.month ?? lastMonth());
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);

  const person = people.find((p) => p.id === staffId);
  const q = query.trim().toLowerCase();
  const shown = q ? people.filter((p) => `${p.name} ${p.userId} ${p.store ?? ""}`.toLowerCase().includes(q)).slice(0, 30) : [];

  const fill = async (k: string, who = staffId, m = month) => {
    setKind(k);
    setError("");
    if (!k || !who) return;
    if ((subject || body) && !window.confirm("Replace the text you have written with the template?")) return;
    setBusy(true);
    try {
      const t = await call(`/api/staff/letters/template?staffId=${who}&kind=${k}&month=${m}`, "GET");
      setSubject(t.subject ?? "");
      setBody(t.body ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  // Started from a record: fill the letter in from Care straight away.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !start?.staffId || !start.kind) return;
    started.current = true;
    void fill(start.kind, start.staffId, start.month ?? month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await call("/api/staff/letters", "POST", { staffId, kind, subject, body });
      setNotice(
        r.status === "sent"
          ? `Letter ${r.number} sent to ${person?.name}${r.emailStatus === "sent" ? " (app + e-mail)" : r.emailStatus === "no e-mail address" ? " (app only — no e-mail address)" : ""}.`
          : `Letter sent for approval. HR / the Director will check it before it goes to ${person?.name}.`
      );
      setStaffId("");
      setKind("");
      setSubject("");
      setBody("");
      setQuery("");
      setConfirming(false);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  if (!open) {
    return (
      <div className="space-y-3">
        {notice && <p className="rounded-2xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">{notice}</p>}
        <button type="button" className={pinkBtn} onClick={() => { setOpen(true); setNotice(""); }}>
          + New warning letter
        </button>
      </div>
    );
  }

  return (
    <section className="soft-card space-y-4 rounded-3xl bg-white p-5 ring-1 ring-black/5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">New warning letter</h2>
          <p className="mt-1 text-xs text-black/50">
            {direct
              ? "It goes to the staff member at once: in the app, as a phone notification and by e-mail with the PDF letter."
              : "HR or the Director checks it first; once approved it goes to the staff member in the app and by e-mail."}
          </p>
        </div>
        <button type="button" className="text-sm font-semibold text-black/45" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <div>
        <label className="text-xs font-bold uppercase text-black/50">1. Staff member</label>
        {person ? (
          <div className="mt-1 flex flex-wrap items-center gap-3 rounded-2xl bg-[#f7f9fb] px-4 py-3 text-sm">
            <span className="font-semibold">{person.name}</span>
            <span className="text-black/50">
              {person.userId} · {person.designation} · {person.store ?? "—"}
            </span>
            <button type="button" className="ml-auto text-xs font-bold text-[#ff5e79]" onClick={() => { setStaffId(""); setKind(""); setSubject(""); setBody(""); }}>
              Change
            </button>
          </div>
        ) : (
          <>
            <input className={`${box} mt-1`} placeholder="Type a name, code or store" value={query} onChange={(e) => setQuery(e.target.value)} />
            {shown.length > 0 && (
              <ul className="mt-2 max-h-64 divide-y divide-black/5 overflow-auto rounded-2xl ring-1 ring-black/10">
                {shown.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="w-full px-4 py-2.5 text-left text-sm hover:bg-[#f7f9fb]" onClick={() => setStaffId(p.id)}>
                      <span className="font-semibold">{p.name}</span>
                      <span className="text-black/50"> · {p.userId} · {p.designation} · {p.store ?? "—"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {q && shown.length === 0 && <p className="mt-2 text-xs text-black/50">Nobody found.</p>}
          </>
        )}
      </div>

      {person && (
        <div>
          <label className="text-xs font-bold uppercase text-black/50">2. Reason</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {Object.entries(kinds).map(([k, label]) => (
              <button
                key={k}
                type="button"
                disabled={busy}
                onClick={() => fill(k)}
                className={`rounded-full px-4 py-2 text-xs font-bold ${kind === k ? "bg-[#161616] text-white" : "bg-black/5 text-black/70"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {(kind === "performance" || kind === "attendance") && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="text-black/55">Month:</span>
              <input type="month" className="rounded-xl border border-black/10 px-3 py-1.5" value={month} onChange={(e) => { setMonth(e.target.value); fill(kind, staffId, e.target.value); }} />
            </div>
          )}
          {kind && <p className="mt-2 text-xs text-black/50">The details below are taken from Care (opening & closing, sales, punching machine, explanations). Check them and change anything you need.</p>}
        </div>
      )}

      {person && kind && (
        <>
          <div>
            <label className="text-xs font-bold uppercase text-black/50">3. Subject</label>
            <input className={`${box} mt-1`} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          </div>
          <div>
            <label className="text-xs font-bold uppercase text-black/50">4. Letter</label>
            <textarea className={`${box} mt-1 min-h-[320px] font-[inherit] leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
          {confirming ? (
            <div className="rounded-2xl bg-amber-50 p-4 text-sm">
              <p className="font-semibold text-amber-900">
                {direct
                  ? `Send this warning letter to ${person.name} now? It can't be taken back once sent.`
                  : `Send this letter for approval?`}
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" className={pinkBtn} disabled={busy} onClick={send}>
                  {busy ? "Sending…" : direct ? "Yes, send it" : "Yes, send for approval"}
                </button>
                <button type="button" className={plainBtn} disabled={busy} onClick={() => setConfirming(false)}>
                  Not yet
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={pinkBtn} disabled={busy || !subject.trim() || !body.trim()} onClick={() => { setError(""); setConfirming(true); }}>
              {direct ? "Send letter" : "Send for approval"}
            </button>
          )}
        </>
      )}
      {error && !(person && kind) && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
    </section>
  );
}

/** Buttons on one letter: acknowledge (the staff member), approve / reject (HR, Director), withdraw (the writer). */
export function LetterActions({
  id,
  canAck,
  canApprove,
  canWithdraw,
  subject: subject0,
  body: body0,
}: {
  id: string;
  canAck: boolean;
  canApprove: boolean;
  canWithdraw: boolean;
  subject: string;
  body: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "ack" | "edit" | "reject" | "withdraw" | "approve">("");
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState(subject0);
  const [body, setBody] = useState(body0);
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const act = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await call(`/api/staff/letters/${id}`, "POST", payload);
      setMode("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  if (!canAck && !canApprove && !canWithdraw) return null;

  return (
    <div className="soft-card space-y-3 rounded-3xl bg-white p-5 ring-1 ring-black/5 sm:p-6">
      {canAck && (
        <>
          <h2 className="text-lg font-bold">Acknowledge this letter</h2>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[#ff5e79]" checked={read} onChange={(e) => setRead(e.target.checked)} />
            <span>I have read this letter and understood it.</span>
          </label>
          <textarea
            className={`${box} min-h-[90px]`}
            placeholder="Your reply (optional) — anything you want the management to know"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
          />
          <button type="button" className={pinkBtn} disabled={busy || !read} onClick={() => act({ action: "ack", note })}>
            {busy ? "Saving…" : "I have read this letter"}
          </button>
        </>
      )}

      {canApprove && (
        <>
          <h2 className="text-lg font-bold">Waiting for your approval</h2>
          {mode === "edit" ? (
            <div className="space-y-2">
              <input className={box} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
              <textarea className={`${box} min-h-[320px] leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={pinkBtn} disabled={busy} onClick={() => act({ action: "approve", subject, body })}>
                  {busy ? "Sending…" : "Save changes, approve & send"}
                </button>
                <button type="button" className={plainBtn} disabled={busy} onClick={() => setMode("")}>
                  Cancel
                </button>
              </div>
            </div>
          ) : mode === "reject" ? (
            <div className="space-y-2">
              <textarea className={`${box} min-h-[80px]`} placeholder="Why is it not approved? (the Store Manager sees this)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={pinkBtn} disabled={busy || note.trim().length < 3} onClick={() => act({ action: "reject", reason: note })}>
                  {busy ? "Saving…" : "Don't send this letter"}
                </button>
                <button type="button" className={plainBtn} disabled={busy} onClick={() => setMode("")}>
                  Cancel
                </button>
              </div>
            </div>
          ) : mode === "approve" ? (
            <div className="rounded-2xl bg-amber-50 p-4 text-sm">
              <p className="font-semibold text-amber-900">Approve and send this letter now? It can't be taken back once sent.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" className={pinkBtn} disabled={busy} onClick={() => act({ action: "approve" })}>
                  {busy ? "Sending…" : "Yes, approve & send"}
                </button>
                <button type="button" className={plainBtn} disabled={busy} onClick={() => setMode("")}>
                  Not yet
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={pinkBtn} onClick={() => setMode("approve")}>
                Approve & send
              </button>
              <button type="button" className={plainBtn} onClick={() => setMode("edit")}>
                Edit, then approve
              </button>
              <button type="button" className={plainBtn} onClick={() => { setNote(""); setMode("reject"); }}>
                Don&apos;t approve
              </button>
            </div>
          )}
        </>
      )}

      {canWithdraw && !canApprove && (
        <>
          <p className="text-sm text-black/60">This letter is waiting for HR / the Director to approve it.</p>
          {mode === "withdraw" ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={pinkBtn} disabled={busy} onClick={() => act({ action: "withdraw" })}>
                {busy ? "Saving…" : "Yes, withdraw it"}
              </button>
              <button type="button" className={plainBtn} disabled={busy} onClick={() => setMode("")}>
                Keep it
              </button>
            </div>
          ) : (
            <button type="button" className={plainBtn} onClick={() => setMode("withdraw")}>
              Withdraw this letter
            </button>
          )}
        </>
      )}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}

/** The issuer's own signature on letters (name and title under "For Seven Years,"). */
export function LetterSignature({ name: name0, title: title0 }: { name: string; title: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(name0);
  const [title, setTitle] = useState(title0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await call("/api/staff/letters/signature", "POST", { name, title });
      setName(r.name);
      setTitle(r.title);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <section className="soft-card rounded-3xl bg-white p-5 ring-1 ring-black/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-black/50">Your signature on letters</p>
          {!editing && (
            <p className="mt-1 text-sm">
              For Seven Years,
              <br />
              <span className="font-bold">{name}</span>
              <br />
              <span className="text-black/55">{title}</span>
            </p>
          )}
        </div>
        {!editing && (
          <button type="button" className={plainBtn} onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input className={box} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name as printed" maxLength={80} />
          <input className={box} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. Head of HR)" maxLength={80} />
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={pinkBtn} disabled={busy || !name.trim()} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className={plainBtn} disabled={busy} onClick={() => { setName(name0); setTitle(title0); setEditing(false); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
    </section>
  );
}
