"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const box = "w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-[#ff5e79]";
const pinkBtn = "rounded-full bg-[#ff5e79] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const darkBtn = "rounded-full bg-[#161616] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const plainBtn = "rounded-full bg-black/5 px-5 py-2.5 text-sm font-bold text-black/70 disabled:opacity-50";
const smallBtn = "rounded-full bg-black/5 px-3 py-1.5 text-xs font-bold text-black/70 disabled:opacity-50";
const card = "soft-card rounded-3xl bg-white p-5 ring-1 ring-black/5 sm:p-6";

type Settings = {
  rules: {
    sop_sm: { on: boolean; from: string };
    late: { on: boolean; from: string };
    performance: { on: boolean; from: string; threshold: number };
  };
  signer: string | null;
  controllers: string[];
};
type CaseRow = {
  id: string;
  staffId: string;
  name: string;
  code: string;
  store: string | null;
  track: string;
  trackLabel: string;
  stage: string;
  status: "active" | "paused";
  next: string;
  note: string | null;
  updated: string;
  history: { at: string; note: string; by: string | null; letterId: string | null }[];
};
type Action = { track: string; staffId: string; name: string; store: string | null; what: string; kind: string | null; needs: string | null; subject: string | null; body: string | null };

const TRACKS: Record<string, string> = { sop_sm: "SOP (Store Manager)", late: "Late coming", performance: "Sales performance" };
const ROLE: Record<string, string> = { hr_executive: "HR Executive", hr_head: "HR Head", store_manager: "Store Manager" };

async function call(body: unknown) {
  const response = await fetch("/api/staff/letters/auto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = response ? await response.json().catch(() => ({})) : {};
  if (!response?.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}

export function DisciplinePanel({
  superAdmin,
  settings,
  people,
  signers,
  controllerChoices,
  cases,
  runs,
}: {
  superAdmin: boolean;
  settings: Settings;
  people: { id: string; name: string; store: string | null }[];
  signers: { id: string; name: string }[];
  controllerChoices: { id: string; name: string; role: string; store: string | null }[];
  cases: CaseRow[];
  runs: { day: string; result: string }[];
}) {
  return (
    <div className="space-y-8">
      <Rules superAdmin={superAdmin} settings={settings} signers={signers} controllerChoices={controllerChoices} />
      <Today superAdmin={superAdmin} />
      <Cases cases={cases} />
      <PauseSomeone people={people} />
      {runs.length > 0 && (
        <section className={card}>
          <h2 className="text-lg font-bold">Recent runs</h2>
          <ul className="mt-3 space-y-1 text-sm text-black/65">
            {runs.map((r) => (
              <li key={r.day}>
                <span className="font-semibold text-black/80">{r.day}</span> — {r.result || "—"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Switch({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-[#22b573]" : "bg-black/15"} disabled:opacity-70`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${on ? "left-6" : "left-1"}`} />
    </button>
  );
}

function Rules({
  superAdmin,
  settings,
  signers,
  controllerChoices,
}: {
  superAdmin: boolean;
  settings: Settings;
  signers: { id: string; name: string }[];
  controllerChoices: { id: string; name: string; role: string; store: string | null }[];
}) {
  const router = useRouter();
  const [s, setS] = useState<Settings>(settings);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const off = !editing;

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await call({ action: "settings", settings: s });
      setEditing(false);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  const rule = <K extends keyof Settings["rules"]>(k: K, patch: Partial<Settings["rules"][K]>) => setS({ ...s, rules: { ...s.rules, [k]: { ...s.rules[k], ...patch } } });
  const signerName = signers.find((x) => x.id === s.signer)?.name ?? "the Super Admin";

  return (
    <section className={`${card} space-y-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Rules</h2>
        {superAdmin && !editing && (
          <button type="button" className={plainBtn} onClick={() => { setEditing(true); setSaved(false); }}>
            Edit
          </button>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-start gap-4 rounded-2xl bg-[#f7f9fb] p-4">
          <Switch on={s.rules.sop_sm.on} disabled={off} onChange={(v) => rule("sop_sm", { on: v })} />
          <div className="flex-1 space-y-2 text-sm">
            <p className="font-bold">SOP — warning to the Store Manager</p>
            <p className="text-black/60">
              3 deviations at the store in 30 days (opened / closed by someone not allowed, camera early / late, proxy punch) that the Director has not approved by 11 am the
              next day → warning letter to the Store Manager, sent automatically. The count starts again after each letter.
            </p>
            <label className="flex flex-wrap items-center gap-2 text-black/70">
              Count from
              <input type="date" className="rounded-xl border border-black/10 px-3 py-1.5" value={s.rules.sop_sm.from} disabled={off} onChange={(e) => rule("sop_sm", { from: e.target.value })} />
            </label>
          </div>
        </div>

        <div className="flex items-start gap-4 rounded-2xl bg-[#f7f9fb] p-4">
          <Switch on={s.rules.late.on} disabled={off} onChange={(v) => rule("late", { on: v })} />
          <div className="flex-1 space-y-2 text-sm">
            <p className="font-bold">Late coming — reminder, then warning</p>
            <p className="text-black/60">
              In a calendar month: 3 late days in a row, or more than 45 minutes late in all → a polite reminder. When it happens again in the same or the next month →
              warning letter. Both are sent automatically.
            </p>
            <label className="flex flex-wrap items-center gap-2 text-black/70">
              Count from
              <input type="date" className="rounded-xl border border-black/10 px-3 py-1.5" value={s.rules.late.from} disabled={off} onChange={(e) => rule("late", { from: e.target.value })} />
            </label>
          </div>
        </div>

        <div className="flex items-start gap-4 rounded-2xl bg-[#f7f9fb] p-4">
          <Switch on={s.rules.performance.on} disabled={off} onChange={(v) => rule("performance", { on: v })} />
          <div className="flex-1 space-y-2 text-sm">
            <p className="font-bold">Sales performance — PIP, second warning, final warning, termination</p>
            <p className="text-black/60">
              Below the limit for 3 months in a row → Performance Improvement Plan for 60 days (sent automatically). Not improved → second warning (sent
              automatically, 30 days). Not improved → final warning, prepared for the Super Admin to send (30 days). Not improved → termination letter, prepared for the
              Super Admin. Reaching the limit in the last month of a step closes the case.
            </p>
            <div className="flex flex-wrap gap-4 text-black/70">
              <label className="flex items-center gap-2">
                Poor month: below
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="w-20 rounded-xl border border-black/10 px-3 py-1.5"
                  value={s.rules.performance.threshold}
                  disabled={off}
                  onChange={(e) => rule("performance", { threshold: Number(e.target.value) })}
                />
                % of target
              </label>
              <label className="flex items-center gap-2">
                First month that counts
                <input type="month" className="rounded-xl border border-black/10 px-3 py-1.5" value={s.rules.performance.from} disabled={off} onChange={(e) => rule("performance", { from: e.target.value })} />
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-bold">Letters are signed by</span>
          {editing ? (
            <select className={box} value={s.signer ?? ""} onChange={(e) => setS({ ...s, signer: e.target.value || null })}>
              <option value="">The Super Admin</option>
              {signers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-black/65">{signerName} (name, title and signature as set on the Warning letters page)</p>
          )}
        </label>
        <div className="space-y-1 text-sm">
          <span className="font-bold">Manual controls also for</span>
          {editing ? (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-black/10 p-3">
              {controllerChoices.length === 0 && <p className="text-black/50">No HR Executive or Store Manager accounts.</p>}
              {controllerChoices.map((p) => (
                <label key={p.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#ff5e79]"
                    checked={s.controllers.includes(p.id)}
                    onChange={(e) => setS({ ...s, controllers: e.target.checked ? [...s.controllers, p.id] : s.controllers.filter((x) => x !== p.id) })}
                  />
                  <span>
                    {p.name} <span className="text-black/45">({ROLE[p.role] ?? p.role}{p.store ? ` · ${p.store}` : ""})</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-black/65">
              {s.controllers.length
                ? controllerChoices
                    .filter((p) => s.controllers.includes(p.id))
                    .map((p) => `${p.name} (${ROLE[p.role] ?? p.role}${p.role === "store_manager" && p.store ? `, ${p.store} only` : ""})`)
                    .join(", ")
                : "Only the Super Admin"}
            </p>
          )}
          <p className="text-xs text-black/45">They can pause, resume and reset people. Only the Super Admin changes the rules and sends final warnings and terminations.</p>
        </div>
      </div>

      {error && <p className="text-sm font-semibold text-[#d63a57]">{error}</p>}
      {saved && !editing && <p className="text-sm font-semibold text-green-700">Saved.</p>}
      {editing && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={pinkBtn} disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className={plainBtn} disabled={busy} onClick={() => { setS(settings); setEditing(false); setError(""); }}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

function Today({ superAdmin }: { superAdmin: boolean }) {
  const router = useRouter();
  const [actions, setActions] = useState<Action[] | null>(null);
  const [summary, setSummary] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "run">("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");

  const go = async (action: "preview" | "run") => {
    setBusy(action);
    setError("");
    try {
      const r = await call({ action });
      setActions(r.actions);
      setSummary(action === "run" ? `Done: ${r.summary}` : r.summary);
      setProblems(r.errors ?? []);
      setConfirm(false);
      if (action === "run") router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy("");
  };

  return (
    <section className={`${card} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">What is due today</h2>
          <p className="text-sm text-black/55">Check what the morning run sends. Checking sends nothing.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={darkBtn} disabled={!!busy} onClick={() => go("preview")}>
            {busy === "preview" ? "Checking…" : "Check now"}
          </button>
          {superAdmin && !confirm && (
            <button type="button" className={plainBtn} disabled={!!busy} onClick={() => setConfirm(true)}>
              Run now
            </button>
          )}
        </div>
      </div>
      {confirm && (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Send the letters that are due now? Reminders, warnings and PIPs go to the staff at once; final warnings and terminations wait for you.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={pinkBtn} disabled={!!busy} onClick={() => go("run")}>
              {busy === "run" ? "Sending…" : "Yes, run now"}
            </button>
            <button type="button" className={plainBtn} disabled={!!busy} onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm font-semibold text-[#d63a57]">{error}</p>}
      {actions && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">{summary}</p>
          {problems.map((p) => (
            <p key={p} className="text-xs text-[#d63a57]">
              {p}
            </p>
          ))}
          {actions.length === 0 ? (
            <p className="text-sm text-black/55">Nothing is due.</p>
          ) : (
            <ul className="divide-y divide-black/5 rounded-2xl ring-1 ring-black/5">
              {actions.map((a, i) => (
                <li key={`${a.staffId}-${a.track}`} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.name}</span>
                    <span className="text-black/45">{a.store ?? ""}</span>
                    <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-bold uppercase text-black/55">{TRACKS[a.track] ?? a.track}</span>
                    {a.needs && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">Waits for Super Admin</span>}
                  </div>
                  <p className="mt-1 text-black/65">{a.what}</p>
                  {a.body && (
                    <button type="button" className="mt-1 text-xs font-semibold text-[#11b8d0] hover:underline" onClick={() => setOpen(open === i ? null : i)}>
                      {open === i ? "Hide the letter" : "Show the letter"}
                    </button>
                  )}
                  {open === i && a.body && (
                    <div className="mt-2 rounded-2xl bg-[#f7f9fb] p-4">
                      <p className="font-bold">Subject: {a.subject}</p>
                      <p className="mt-2 whitespace-pre-line text-black/75">{a.body}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Cases({ cases }: { cases: CaseRow[] }) {
  const [track, setTrack] = useState("");
  const list = cases.filter((c) => !track || c.track === track);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">People</h2>
        <select className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm" value={track} onChange={(e) => setTrack(e.target.value)}>
          <option value="">All rules</option>
          {Object.entries(TRACKS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {list.length === 0 ? (
        <p className={`${card} text-sm text-black/55`}>No one yet. People appear here when a rule sends them a letter, or when they are paused.</p>
      ) : (
        <ul className="soft-card divide-y divide-black/5 overflow-hidden rounded-3xl bg-white ring-1 ring-black/5">
          {list.map((c) => (
            <CaseItem key={c.id} c={c} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CaseItem({ c }: { c: CaseRow }) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "pause" | "resume" | "reset">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(false);
  const act = async () => {
    setBusy(true);
    setError("");
    try {
      await call({ action: mode, staffId: c.staffId, track: c.track, note });
      setMode("");
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  const ask: Record<string, string> = {
    pause: "Pause: no automatic letters for this person under this rule until resumed.",
    resume: "Resume: counting starts again from today (nothing from the paused days counts).",
    reset: "Reset: start again from today. Nothing before counts, and a PIP / warning plan in progress ends.",
  };
  return (
    <li className="px-5 py-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{c.name}</span>
        <span className="text-black/45">
          ({c.code}
          {c.store ? ` · ${c.store}` : ""})
        </span>
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-bold uppercase text-black/55">{c.trackLabel}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${c.status === "paused" ? "bg-amber-50 text-amber-800" : "bg-[#11b8d0]/10 text-[#0b8fa3]"}`}>
          {c.status === "paused" ? "Paused" : c.stage}
        </span>
      </div>
      <p className="mt-1 text-black/65">{c.next}</p>
      {c.note && <p className="mt-0.5 text-xs text-black/45">{c.note}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {c.status === "active" ? (
          <button type="button" className={smallBtn} onClick={() => setMode("pause")}>
            ⏸ Pause
          </button>
        ) : (
          <button type="button" className={smallBtn} onClick={() => setMode("resume")}>
            ▶ Resume
          </button>
        )}
        <button type="button" className={smallBtn} onClick={() => setMode("reset")}>
          ↺ Reset
        </button>
        {c.history.length > 0 && (
          <button type="button" className="text-xs font-semibold text-[#11b8d0] hover:underline" onClick={() => setHistory(!history)}>
            {history ? "Hide history" : "History"}
          </button>
        )}
      </div>
      {mode && (
        <div className="mt-3 space-y-2 rounded-2xl bg-[#f7f9fb] p-3">
          <p className="text-black/70">{ask[mode]}</p>
          <input className={box} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={pinkBtn} disabled={busy} onClick={act}>
              {busy ? "Saving…" : mode === "pause" ? "Pause" : mode === "resume" ? "Resume" : "Reset"}
            </button>
            <button type="button" className={plainBtn} disabled={busy} onClick={() => setMode("")}>
              Cancel
            </button>
          </div>
          {error && <p className="text-sm font-semibold text-[#d63a57]">{error}</p>}
        </div>
      )}
      {history && (
        <ul className="mt-3 space-y-1 border-l-2 border-black/10 pl-3 text-xs text-black/60">
          {c.history.map((h, i) => (
            <li key={i}>
              <span className="font-semibold text-black/75">{h.at}</span> — {h.note}
              {h.by ? ` (${h.by})` : ""}
              {h.letterId && (
                <>
                  {" "}
                  <Link href={`/staff/letters/${h.letterId}`} className="font-semibold text-[#11b8d0] hover:underline">
                    open letter
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PauseSomeone({ people }: { people: { id: string; name: string; store: string | null }[] }) {
  const router = useRouter();
  const [staffId, setStaffId] = useState("");
  const [track, setTrack] = useState("late");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const pause = async () => {
    setBusy(true);
    setError("");
    setDone("");
    try {
      await call({ action: "pause", staffId, track, note });
      setDone(`${people.find((p) => p.id === staffId)?.name ?? ""} paused for ${TRACKS[track]}.`);
      setStaffId("");
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  return (
    <section className={`${card} space-y-3`}>
      <h2 className="text-lg font-bold">Pause someone</h2>
      <p className="text-sm text-black/55">For example on approved leave or a medical reason: no automatic letters for them under the rule until you resume.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <select className={box} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="">Choose the person…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.store ? ` (${p.store})` : ""}
            </option>
          ))}
        </select>
        <select className={box} value={track} onChange={(e) => setTrack(e.target.value)}>
          {Object.entries(TRACKS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input className={box} placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>
      <button type="button" className={pinkBtn} disabled={busy || !staffId} onClick={pause}>
        {busy ? "Saving…" : "⏸ Pause"}
      </button>
      {error && <p className="text-sm font-semibold text-[#d63a57]">{error}</p>}
      {done && <p className="text-sm font-semibold text-green-700">{done}</p>}
    </section>
  );
}
