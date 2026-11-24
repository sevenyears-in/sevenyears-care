"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorBox } from "@/components/SiteChrome";

type Row = { id: number; userId: string; kind: "shift" | "store"; value: string; validFrom: string; note: string | null; createdBy: string | null };
type Person = {
  userId: string;
  name: string;
  store: string | null;
  shift: Row[];
  stores: Row[];
  target: number | null;
  abvTarget: number | null;
  editable: boolean;
  /** Part-time salesperson without a login (PT code): target only. */
  partTime: boolean;
};
type Shift = { name: string; start: string; end?: string };
type Data = { people: Person[]; shifts: Shift[]; grace: number; stores: string[]; month: string; can: { manage: boolean; transfer: boolean; delete: boolean; allStores: boolean } };

const card = "rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5";
const input = "rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-black/10";
const primary = "rounded-xl bg-[#161616] px-4 py-2 text-sm font-bold text-white disabled:opacity-40";
const ghost = "rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-black/10 disabled:opacity-40";
const EARLIEST = "2000-01-01";

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const nice = (t?: string) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
};
const day = (d: string) => (d === EARLIEST ? "the start" : new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }));
function valueOn(list: Row[], d: string) {
  let v: string | null = null;
  for (const r of list) if (r.validFrom <= d) v = r.value;
  return v;
}

async function post(body: unknown) {
  const r = await fetch("/api/staff/admin/assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || "Could not save.");
  return j;
}

const rupees = (v: number | null) => (v ? `₹${v.toLocaleString("en-IN")}` : "—");
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export default function TeamSetup() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(today().slice(0, 7));
  const load = (m = month) =>
    fetch(`/api/staff/admin/assignments?month=${m}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.error ? setError(j.error) : setData(j)))
      .catch(() => setError("Could not load."));
  useEffect(() => {
    load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Shifts, targets &amp; transfers</h1>
        <p className="mt-2 max-w-3xl text-sm text-black/60">
          Each person&apos;s monthly target, shift and store. A shift or store change applies from its date (<b>valid from</b>); earlier
          days keep the earlier shift and store, so late coming, duties, targets and incentives of past days don&apos;t change.
          {data && !data.can.allStores ? " You can set targets and shifts for your store's team." : ""}
        </p>
      </div>
      <ErrorBox message={error} />
      {data && (
        <>
          <ShiftsCard data={data} reload={() => load()} />
          <PeopleCard data={data} reload={() => load()} month={month} setMonth={setMonth} />
        </>
      )}
    </div>
  );
}

function ShiftsCard({ data, reload }: { data: Data; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>(data.shifts);
  const [grace, setGrace] = useState(String(data.grace));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [done, setDone] = useState("");

  const start = () => {
    setShifts(data.shifts.map((s) => ({ ...s })));
    setGrace(String(data.grace));
    setError("");
    setEditing(true);
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await post({ action: "shifts", shifts, grace });
      setEditing(false);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setDone("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/staff/admin/assignments", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || "Could not read the file.");
      setDone(`✓ ${j.shifts} shifts and ${j.people} people's shifts saved${j.skipped?.length ? ` (${j.skipped.length} row(s) skipped: ${j.skipped.join(", ")})` : ""}.`);
      setFile(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Shifts</h2>
          <p className="mt-1 text-sm text-black/60">The first shift is used for anyone without a shift of their own.</p>
        </div>
        {!data.can.manage ? null : !editing ? (
          <button className={primary} onClick={start}>
            ✎ Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button className={primary} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className={ghost} disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      <ErrorBox message={error} />
      {editing ? (
        <div className="mt-4 space-y-2 text-sm">
          {shifts.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input className={`${input} w-36`} value={s.name} maxLength={40} onChange={(e) => setShifts(shifts.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
              from
              <input type="time" className={`${input} w-32`} value={s.start} onChange={(e) => setShifts(shifts.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)))} />
              to
              <input type="time" className={`${input} w-32`} value={s.end ?? ""} onChange={(e) => setShifts(shifts.map((x, k) => (k === i ? { ...x, end: e.target.value || undefined } : x)))} />
              {shifts.length > 1 && (
                <button className="text-xs font-semibold text-red-700" onClick={() => setShifts(shifts.filter((_, k) => k !== i))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <button className="text-sm font-semibold text-[#5b55c9]" onClick={() => setShifts([...shifts, { name: `SHIFT ${shifts.length + 1}`, start: "09:00", end: "19:00" }])}>
            + Add shift
          </button>
          <label className="flex items-center gap-2 pt-2">
            Late when the first punch is more than
            <input className={`${input} w-20`} inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value.replace(/[^\d]/g, ""))} />
            minutes after the shift start
          </label>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.shifts.map((s, i) => (
            <span key={s.name} className={`rounded-full px-3 py-1.5 text-sm ring-1 ${i === 0 ? "bg-[#8883d7]/10 ring-[#8883d7]/30" : "bg-black/[0.03] ring-black/10"}`}>
              <b>{s.name}</b> {nice(s.start)}
              {s.end ? ` – ${nice(s.end)}` : ""}
            </span>
          ))}
          <span className="px-1 py-1.5 text-sm text-black/55">· late after {data.grace} min</span>
        </div>
      )}

      {data.can.manage && (
      <div className="mt-6 rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
        <p className="text-sm font-semibold">Import from eTimeTrackLite</p>
        <p className="mt-1 text-xs text-black/55">
          Reports → Employee Shift → export to Excel. Shifts and each person&apos;s shift with its <b>Valid From</b> are saved; changes already
          here on other dates are kept. The Branch column is not used (transfers are entered below).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          <button className={primary} disabled={!file || busy} onClick={upload}>
            {busy && file ? "Importing…" : "Import"}
          </button>
        </div>
        {done && <p className="mt-2 text-sm font-semibold text-green-700">{done}</p>}
      </div>
      )}
    </div>
  );
}

function PeopleCard({ data, reload, month, setMonth }: { data: Data; reload: () => void; month: string; setMonth: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState("");
  const [editT, setEditT] = useState(false);
  const [draft, setDraft] = useState<Record<string, { sales: string; abv: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const now = today();
  const startTargets = () => {
    const d: Record<string, { sales: string; abv: string }> = {};
    for (const p of data.people) d[p.userId] = { sales: p.target ? String(p.target) : "", abv: p.abvTarget ? String(p.abvTarget) : "" };
    setDraft(d);
    setError("");
    setSavedMsg("");
    setEditT(true);
  };
  const saveTargets = async () => {
    setBusy(true);
    setError("");
    try {
      const rows = data.people
        .filter((p) => p.editable)
        .filter((p) => (draft[p.userId]?.sales ?? "") !== (p.target ? String(p.target) : "") || (draft[p.userId]?.abv ?? "") !== (p.abvTarget ? String(p.abvTarget) : ""))
        .map((p) => ({ userId: p.userId, sales: draft[p.userId]?.sales ?? "", abv: draft[p.userId]?.abv ?? "" }));
      if (rows.length) await post({ action: "targets", month, rows });
      setEditT(false);
      setSavedMsg(rows.length ? `✓ ${rows.length} target(s) saved for ${monthName(month)}` : "Nothing changed.");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.people.filter((p) => !s || p.name.toLowerCase().includes(s) || p.userId.toLowerCase().includes(s));
  }, [data.people, q]);

  // Add a part-time salesperson (no login) so their target can be set before their first bill.
  const [adding, setAdding] = useState(false);
  const [ptName, setPtName] = useState("");
  const [ptStore, setPtStore] = useState("");
  const addPt = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await post({ action: "pt_add", name: ptName, store: ptStore, month });
      setSavedMsg(r.added ? `✓ ${ptName.toUpperCase()} added as ${r.code}. Set their target with ✎ Edit targets.` : `✓ ${ptName.toUpperCase()} (${r.code}) is now in this store.`);
      setAdding(false);
      setPtName("");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">People</h2>
          <p className="mt-1 text-sm text-black/60">
            Targets are for the month chosen here. Open a person to change their shift{data.can.transfer ? " or transfer them to another store" : ""} from a date.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" className={input} value={month} disabled={editT} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          {!editT ? (
            <button className={primary} onClick={startTargets} disabled={!data.people.some((p) => p.editable)}>
              ✎ Edit targets
            </button>
          ) : (
            <>
              <button className={primary} disabled={busy} onClick={saveTargets}>
                {busy ? "Saving…" : "Save targets"}
              </button>
              <button className={ghost} disabled={busy} onClick={() => setEditT(false)}>
                Cancel
              </button>
            </>
          )}
          <input className={`${input} w-56`} placeholder="Search name or User ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <ErrorBox message={error} />
      {savedMsg && <p className="mt-2 text-sm font-semibold text-green-700">{savedMsg}</p>}
      <div className="mt-3">
        {!adding ? (
          <button className={ghost} disabled={editT} onClick={() => { setAdding(true); setError(""); setSavedMsg(""); }}>
            + Add part-time person
          </button>
        ) : (
          <div className="rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
            <p className="text-sm font-semibold">Add a part-time person</p>
            <p className="mt-1 text-xs text-black/55">
              Part-time staff don&apos;t log in, so they aren&apos;t in Staff Users. Type the name exactly as it is in Zoho POS (salesperson), so their bills count for them.
              {data.can.allStores ? "" : " They are added to your store."} Someone who already billed shows here by themselves.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input className={`${input} w-64`} placeholder="Name as in Zoho POS" value={ptName} onChange={(e) => setPtName(e.target.value)} />
              {data.can.allStores && (
                <select className={input} value={ptStore} onChange={(e) => setPtStore(e.target.value)}>
                  <option value="">Choose the store…</option>
                  {data.stores.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              )}
              <button className={primary} disabled={busy || ptName.trim().length < 3 || (data.can.allStores && !ptStore)} onClick={addPt}>
                {busy ? "Adding…" : "Add"}
              </button>
              <button className={ghost} disabled={busy} onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-black/45">
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Store today</th>
              <th className="px-2 py-2">Target · {monthName(month)}</th>
              <th className="px-2 py-2">ABV target</th>
              <th className="px-2 py-2">Shift today</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const shiftNow = valueOn(p.shift, now) ?? data.shifts[0]?.name;
              const storeNow = valueOn(p.stores, now) ?? p.store;
              const upcoming = [...p.shift, ...p.stores].filter((r) => r.validFrom > now);
              return (
                <PersonRows
                  key={p.userId}
                  editT={editT}
                  draft={draft[p.userId]}
                  setDraft={(v) => setDraft({ ...draft, [p.userId]: v })}
                  p={p}
                  data={data}
                  storeNow={storeNow}
                  shiftNow={shiftNow}
                  upcoming={upcoming.length}
                  open={open === p.userId}
                  toggle={() => setOpen(open === p.userId ? "" : p.userId)}
                  reload={reload}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PersonRows({
  editT,
  draft,
  setDraft,
  p,
  data,
  storeNow,
  shiftNow,
  upcoming,
  open,
  toggle,
  reload,
}: {
  editT: boolean;
  draft?: { sales: string; abv: string };
  setDraft: (v: { sales: string; abv: string }) => void;
  p: Person;
  data: Data;
  storeNow: string | null;
  shiftNow: string | undefined;
  upcoming: number;
  open: boolean;
  toggle: () => void;
  reload: () => void;
}) {
  const shiftDef = data.shifts.find((s) => s.name === shiftNow);
  return (
    <>
      <tr className="border-t border-black/5">
        <td className="px-2 py-2">
          <span className="font-semibold">{p.name}</span> <span className="text-xs text-black/45">{p.userId}</span>
          {p.partTime && <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Part-time</span>}
        </td>
        <td className="px-2 py-2">{(p.partTime ? p.store : storeNow) ?? "—"}</td>
        <td className="px-2 py-2">
          {editT && p.editable ? (
            <input className={`${input} w-28`} inputMode="numeric" placeholder="₹" value={draft?.sales ?? ""} onChange={(e) => setDraft({ sales: e.target.value.replace(/[^\d]/g, ""), abv: draft?.abv ?? "" })} />
          ) : (
            rupees(p.target)
          )}
        </td>
        <td className="px-2 py-2">
          {editT && p.editable ? (
            <input className={`${input} w-24`} inputMode="numeric" placeholder="₹" value={draft?.abv ?? ""} onChange={(e) => setDraft({ sales: draft?.sales ?? "", abv: e.target.value.replace(/[^\d]/g, "") })} />
          ) : (
            rupees(p.abvTarget)
          )}
        </td>
        <td className="px-2 py-2">
          {p.partTime ? <span className="text-xs text-black/40">—</span> : shiftNow}
          {shiftDef && !p.partTime ? <span className="text-xs text-black/45"> {nice(shiftDef.start)}{shiftDef.end ? `–${nice(shiftDef.end)}` : ""}</span> : null}
          {upcoming ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{upcoming} coming</span> : null}
        </td>
        <td className="px-2 py-2 text-right">
          {!p.partTime && (
            <button className={ghost} onClick={toggle}>
              {open ? "Close" : p.editable ? "History / change" : "History"}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="px-2 pb-4">
            <div className="grid gap-4 rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5 md:grid-cols-2">
              <History title="Shift" kind="shift" p={p} rows={p.shift} options={data.shifts.map((s) => s.name)} defaultNote={`Before the first change: ${data.shifts[0]?.name}`} reload={reload} canEdit={p.editable} canDelete={p.editable && data.can.delete} />
              <History title="Store" kind="store" p={p} rows={p.stores} options={data.stores} defaultNote={`No transfers yet: ${p.store ?? "no store"} on every day`} reload={reload} canEdit={p.editable && data.can.transfer} canDelete={p.editable && data.can.delete && data.can.transfer} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function History({
  title,
  kind,
  p,
  rows,
  options,
  defaultNote,
  reload,
  canEdit,
  canDelete,
}: {
  canEdit: boolean;
  canDelete: boolean;
  title: string;
  kind: "shift" | "store";
  p: Person;
  rows: Row[];
  options: string[];
  defaultNote: string;
  reload: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [fromStore, setFromStore] = useState(p.store ?? "");
  const [validFrom, setValidFrom] = useState(today());
  const [note, setNote] = useState("");
  const [editId, setEditId] = useState(0);
  const [edit, setEdit] = useState({ value: "", validFrom: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstTransfer = kind === "store" && rows.length === 0;

  const run = async (body: unknown, after: () => void) => {
    setBusy(true);
    setError("");
    try {
      await post(body);
      after();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-black/45">{title} history</p>
        {!adding && canEdit && (
          <button
            className="text-sm font-semibold text-[#5b55c9]"
            onClick={() => {
              setAdding(true);
              setValue("");
              setNote("");
              setValidFrom(today());
              setFromStore(p.store ?? "");
              setError("");
            }}
          >
            {kind === "store" ? "+ Transfer" : "+ New shift"}
          </button>
        )}
      </div>
      <ErrorBox message={error} />
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-black/50">{defaultNote}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((r) =>
            editId === r.id ? (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <select className={input} value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })}>
                  {[...new Set([edit.value, ...options])].map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                from
                <input type="date" className={input} value={edit.validFrom} onChange={(e) => setEdit({ ...edit, validFrom: e.target.value })} />
                <input className={`${input} w-44`} placeholder="Note" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
                <button className={primary} disabled={busy} onClick={() => run({ action: "update", id: r.id, ...edit }, () => setEditId(0))}>
                  {busy ? "Saving…" : "Save"}
                </button>
                <button className={ghost} disabled={busy} onClick={() => setEditId(0)}>
                  Cancel
                </button>
              </li>
            ) : (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <b>{r.value}</b> from {day(r.validFrom)}
                  {r.note ? <span className="text-xs text-black/45"> · {r.note}</span> : null}
                </span>
                <span className="flex gap-3 text-xs font-semibold">
                  {canEdit && (
                  <button
                    className="text-[#5b55c9]"
                    onClick={() => {
                      setEditId(r.id);
                      setEdit({ value: r.value, validFrom: r.validFrom, note: r.note ?? "" });
                      setError("");
                    }}
                  >
                    ✎ Edit
                  </button>
                  )}
                  {canDelete && (
                  <button
                    className="text-red-700"
                    disabled={busy}
                    onClick={() => confirm(`Delete "${r.value} from ${day(r.validFrom)}"?`) && run({ action: "delete", id: r.id }, () => undefined)}
                  >
                    Delete
                  </button>
                  )}
                </span>
              </li>
            )
          )}
        </ul>
      )}
      {adding && (
        <div className="mt-3 space-y-2 rounded-xl bg-white p-3 text-sm ring-1 ring-black/10">
          {firstTransfer && (
            <label className="flex flex-wrap items-center gap-2">
              Store before
              <select className={input} value={fromStore} onChange={(e) => setFromStore(e.target.value)}>
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-wrap items-center gap-2">
            {kind === "store" ? "New store" : "New shift"}
            <select className={input} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-wrap items-center gap-2">
            Valid from
            <input type="date" className={input} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </label>
          <input className={`${input} w-full`} placeholder="Note (optional), e.g. transfer order" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button
              className={primary}
              disabled={busy || !value || !validFrom || (firstTransfer && !fromStore)}
              onClick={() => run({ action: "add", userId: p.userId, kind, value, validFrom, note, fromStore }, () => setAdding(false))}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button className={ghost} disabled={busy} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
          {kind === "store" && (
            <p className="text-xs text-black/50">
              From this date their sales, target (split by days in the month) and store pool share go to the new store. Earlier days stay with the old store.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
