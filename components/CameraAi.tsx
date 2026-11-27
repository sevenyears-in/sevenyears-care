"use client";

import { useEffect, useState } from "react";
import { ErrorBox, inputClass } from "@/components/SiteChrome";

type Settings = { on: boolean; model: string; uniform: string; dailyLimit: number; reportTime: string };
type Person = { id: string; staff_id: string | null; name: string; store: string; emails: string; active: boolean; photoUrl: string | null };
type Staff = { id: string; name: string; store: string };
type Data = { settings: Settings; provider: "anthropic" | "openai" | null; lastError: string | null; checkedToday: number; learned?: Record<string, { staff: number; customer: number }>; ready: boolean; people: Person[]; staff: Staff[] };

const card = "rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5";
const btn = "rounded-xl bg-[#161616] px-4 py-2 text-sm font-bold text-white disabled:opacity-40";
const plain = "rounded-xl bg-black/5 px-4 py-2 text-sm font-bold text-black/70 disabled:opacity-40";

async function call(body: unknown) {
  const r = await fetch("/api/staff/admin/camera-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok) throw new Error(d.error ?? "Something went wrong.");
  return d;
}

/** A photo from the computer / phone, made small (longest side 640 px) before upload. */
async function smallJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const scale = Math.min(1, 640 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL("image/jpeg", 0.85);
}

/** Settings → Attendance → AI photo check of the entrance cameras, and people to watch. */
export default function CameraAi() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    fetch("/api/staff/admin/camera-ai", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("Could not load the AI photo check."));
  useEffect(() => {
    load();
  }, []);
  if (!data) return error ? <div className={card}><ErrorBox message={error} /></div> : null;
  return (
    <>
      <AiSettings data={data} reload={load} />
      <People data={data} reload={load} />
    </>
  );
}

function AiSettings({ data, reload }: { data: Data; reload: () => void }) {
  const [s, setS] = useState<Settings>(data.settings);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [test, setTest] = useState<{ store: string; at: string; photoUrl: string | null; result: Record<string, unknown> } | null>(null);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await call({ action: "settings", settings: s });
      setEditing(false);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  const runTest = async () => {
    setBusy(true);
    setError("");
    setTest(null);
    try {
      setTest(await call({ action: "test" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">AI photo check (entrance cameras)</h2>
        {!editing && (
          <button type="button" className={plain} onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-black/60">
        Every doorway-line photo is checked by AI: staff in uniform and people going out are left out of the walk-ins, a group that came together counts once, and
        the people to watch below are recognised.
      </p>
      <p className={`mt-3 rounded-2xl px-4 py-3 text-sm font-semibold ${data.provider ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>
        {data.provider
          ? `Connected to ${data.provider === "anthropic" ? "Anthropic (Claude)" : "OpenAI"} · ${data.checkedToday} photo(s) checked today${
                Object.keys(data.learned ?? {}).length
                  ? ` · learning from your marks: ${Object.entries(data.learned ?? {})
                      .map(([st, n]) => `${st} ${n.staff} staff / ${n.customer} customer`)
                      .join(", ")}`
                  : ""
              }${data.lastError ? ` · last error: ${data.lastError}` : ""}`
          : "Not connected: add ANTHROPIC_API_KEY (or OPENAI_API_KEY) in the hosting's environment variables, then redeploy."}
      </p>
      {!data.ready && <p className="mt-2 text-sm font-semibold text-amber-800">The database update for the AI photo check has not been run yet.</p>}
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" disabled={!editing} checked={s.on} onChange={(e) => setS({ ...s, on: e.target.checked })} />
          AI photo check on
        </label>
        <label className="flex items-center gap-2">
          Most photos per day
          <input type="number" min={10} max={50000} disabled={!editing} className={`${inputClass} w-28`} value={s.dailyLimit} onChange={(e) => setS({ ...s, dailyLimit: Number(e.target.value) })} />
        </label>
        <label className="sm:col-span-2">
          <span className="font-semibold">Staff uniform (what the AI looks for)</span>
          <textarea disabled={!editing} rows={2} className={`${inputClass} mt-1 w-full`} value={s.uniform} onChange={(e) => setS({ ...s, uniform: e.target.value })} />
        </label>
        <label className="flex items-center gap-2">
          Daily e-mail at
          <input type="time" disabled={!editing} className={inputClass} value={s.reportTime} onChange={(e) => setS({ ...s, reportTime: e.target.value })} />
        </label>
        <label className="flex items-center gap-2">
          AI model
          <input disabled={!editing} className={`${inputClass} w-48`} placeholder="default" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} />
        </label>
      </div>
      <ErrorBox message={error} />
      <div className="mt-4 flex flex-wrap gap-2">
        {editing ? (
          <>
            <button type="button" className={btn} disabled={busy} onClick={save}>
              Save
            </button>
            <button type="button" className={plain} disabled={busy} onClick={() => { setS(data.settings); setEditing(false); }}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className={plain} disabled={busy || !data.provider} onClick={runTest}>
            {busy ? "Checking…" : "Test on the latest doorway photo"}
          </button>
        )}
      </div>
      {test && (
        <div className="mt-3 flex flex-wrap gap-4 rounded-2xl bg-[#f7f9fb] p-3 text-sm">
          {test.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={test.photoUrl} alt="Latest doorway photo" className="w-64 rounded-xl" />
          )}
          <div>
            <p className="font-bold">{test.store} · {new Date(test.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
            <p>People: {String(test.result.people)} · staff: {String(test.result.staff)} · customers: {String(test.result.customers)}</p>
            <p>Customer groups: {String(test.result.groups)} · direction: {String(test.result.direction)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function People({ data, reload }: { data: Data; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">People to watch</h2>
        {!adding && (
          <button type="button" className={btn} onClick={() => setAdding(true)}>
            + Add a person
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-black/60">
        The entrance camera recognises them coming in and going out. Each day at {data.settings.reportTime} an e-mail goes to the addresses below with the in / out
        times, the total time inside the store and the photos. Nothing is kept in the app after the e-mail.
      </p>
      <div className="mt-4 space-y-3">
        {adding && <PersonForm staff={data.staff} onDone={() => { setAdding(false); reload(); }} />}
        {data.people.map((p) => (
          <PersonRow key={p.id} p={p} staff={data.staff} reload={reload} />
        ))}
        {!data.people.length && !adding && <p className="text-sm text-black/50">No one yet.</p>}
      </div>
    </div>
  );
}

function PersonRow({ p, staff, reload }: { p: Person; staff: Staff[]; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState(false);
  if (editing) return <PersonForm staff={staff} person={p} onDone={() => { setEditing(false); reload(); }} />;
  const act = async (body: unknown, done: string) => {
    setBusy(true);
    setMsg("");
    try {
      const r = await call(body);
      setMsg(typeof r.sent === "number" ? `${done} (${r.sent} e-mail(s))` : done);
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-[#f7f9fb] p-3 text-sm">
      {p.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.photoUrl} alt={p.name} className="h-20 w-16 rounded-xl object-cover" />
      ) : (
        <div className="flex h-20 w-16 items-center justify-center rounded-xl bg-black/5 text-[10px] text-black/40">No photo</div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-bold">
          {p.name} <span className="font-normal text-black/50">· {p.store}</span> {!p.active && <span className="text-amber-700">(paused)</span>}
        </p>
        <p className="text-black/60">E-mail to: {p.emails}</p>
        {msg && <p className="text-xs text-black/60">{msg}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={plain} disabled={busy} onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className={plain} disabled={busy} onClick={() => act({ action: "report", id: p.id }, "Today's e-mail sent")}>
          Send today&apos;s e-mail now
        </button>
        {confirm ? (
          <>
            <button type="button" className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white" disabled={busy} onClick={() => act({ action: "delete", id: p.id }, "Removed")}>
              Yes, remove
            </button>
            <button type="button" className={plain} onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className={plain} disabled={busy} onClick={() => setConfirm(true)}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function PersonForm({ staff, person, onDone }: { staff: Staff[]; person?: Person; onDone: () => void }) {
  const [staffId, setStaffId] = useState(person?.staff_id ?? "");
  const [name, setName] = useState(person?.name ?? "");
  const [store, setStore] = useState(person?.store ?? "");
  const [emails, setEmails] = useState(person?.emails ?? "");
  const [active, setActive] = useState(person?.active ?? true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pick = (id: string) => {
    setStaffId(id);
    const s = staff.find((x) => x.id === id);
    if (s) {
      setName(s.name);
      if (s.store) setStore(s.store);
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await call({ action: "save", person: { id: person?.id, staff_id: staffId || null, name, store, emails, active, photoB64: photo } });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  return (
    <div className="space-y-3 rounded-2xl bg-[#f7f9fb] p-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="font-semibold">Person</span>
          <select className={`${inputClass} mt-1 w-full`} value={staffId} onChange={(e) => pick(e.target.value)}>
            <option value="">Choose…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.store ? `(${s.store})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="font-semibold">Store (entrance camera)</span>
          <input className={`${inputClass} mt-1 w-full`} value={store} onChange={(e) => setStore(e.target.value.toUpperCase())} />
        </label>
        <label className="sm:col-span-2">
          <span className="font-semibold">E-mail the daily report to</span>
          <input className={`${inputClass} mt-1 w-full`} placeholder="name@example.com, other@example.com" value={emails} onChange={(e) => setEmails(e.target.value)} />
        </label>
        <label>
          <span className="font-semibold">Reference photo (full length, clear face)</span>
          <input
            type="file"
            accept="image/*"
            className="mt-1 block w-full text-xs"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setPhoto(await smallJpeg(f));
            }}
          />
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="New reference photo" className="mt-2 h-24 rounded-xl" />
          )}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Watching (untick to pause)
        </label>
      </div>
      <ErrorBox message={error} />
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={busy || !name || !store} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className={plain} disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
