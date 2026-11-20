"use client";

import { useEffect, useState } from "react";
import { ErrorBox, inputClass } from "@/components/SiteChrome";
import { formatDateTime } from "@/lib/helpers";
import { ROLE_LABELS, type Role } from "@/lib/roles";

export type NotInAppPerson = {
  code: string;
  name: string;
  designation: string;
  department: string;
  status: string;
  store: string;
  role: string;
  punches: number;
  lastPunch: string;
};

const ADDABLE: Role[] = ["csa", "floor_incharge", "store_manager", "technician", "cre", "hr_executive", "hr_head", "service_head", "operations_manager", "admin"];
const CORPORATE = "CORPORATE OFFICE";

/**
 * Settings → Attendance: people who punch on the machines but have no staff account.
 * Each is added with User ID = employee code and a temporary password = the same code;
 * they choose their own password at their first login.
 */
export default function NotInAppStaff({ people, stores, namesAt, scriptVersion, onAdded }: {
  people: NotInAppPerson[];
  stores: string[];
  namesAt: string | null;
  scriptVersion: number;
  onAdded: () => void;
}) {
  type Row = { pick: boolean; name: string; store: string; role: string };
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  // New people (or names that arrived from eTimeTrackLite) fill their row; what was typed stays.
  useEffect(() => {
    setRows((cur) => {
      const next: Record<string, Row> = {};
      for (const p of people) {
        const had = cur[p.code];
        next[p.code] = had
          ? { ...had, name: had.name || p.name }
          : { pick: false, name: p.name, store: p.store, role: p.role };
      }
      return next;
    });
  }, [people]);

  if (people.length === 0) return null;
  const set = (code: string, change: Partial<Row>) => setRows((r) => ({ ...r, [code]: { ...r[code], ...change } }));
  const picked = people.filter((p) => rows[p.code]?.pick);
  const storeChoices = [...new Set([...stores, CORPORATE])];

  const add = async () => {
    setError("");
    setResult("");
    const missingName = picked.find((p) => !rows[p.code]?.name.trim());
    if (missingName) return setError(`Enter the name for ${missingName.code}.`);
    const missingStore = picked.find((p) => !rows[p.code]?.store && rows[p.code]?.role !== "admin");
    if (missingStore) return setError(`Choose the store for ${missingStore.code}.`);
    setBusy(true);
    try {
      const users = picked.map((p) => {
        const r = rows[p.code];
        return {
          fullName: r.name.trim(),
          userId: p.code,
          // Temporary: they choose their own password at their first login.
          password: p.code.length >= 4 ? p.code : `${p.code}${p.code}${p.code}${p.code}`.slice(0, 4),
          role: r.role,
          store: r.store,
        };
      });
      const res = await fetch("/api/staff/admin/users/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not add them.");
      const list = (data.results ?? []) as { userId: string; status: string; message?: string }[];
      const created = list.filter((x) => x.status === "created").length;
      const problems = list.filter((x) => x.status !== "created").map((x) => `${x.userId}: ${x.message ?? x.status}`);
      setResult(`${created} added.${problems.length ? " Not added — " + problems.join("; ") : ""}`);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add them.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">On the punching machine, not in the app ({people.length})</h2>
          <p className="mt-1 max-w-3xl text-sm text-black/60">
            Punched in the last 45 days but have no staff account. Tick, check the name, store and role, and add. Their User ID is
            their employee code and their first password is the same code — they choose their own at their first login.
          </p>
          {!namesAt && (
            <p className="mt-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
              {scriptVersion >= 4
                ? "Names are coming from eTimeTrackLite within a few minutes."
                : "Names come from eTimeTrackLite once the office PC script updates itself (within a few minutes, if the office PC is on). You can also type them."}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, pick: picked.length < people.length }])))}
          className="rounded-xl border border-black/15 px-4 py-2 text-sm font-bold"
        >
          {picked.length < people.length ? "Tick all" : "Untick all"}
        </button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-black/45">
              <th className="py-2 pr-2"></th>
              <th className="py-2 pr-3">Code</th>
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">In eTimeTrackLite</th>
              <th className="py-2 pr-3">Store</th>
              <th className="py-2 pr-3">Role</th>
              <th className="py-2">Last punch</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const r = rows[p.code];
              if (!r) return null;
              return (
                <tr key={p.code} className="border-t border-black/5 align-middle">
                  <td className="py-2 pr-2">
                    <input type="checkbox" checked={r.pick} onChange={(e) => set(p.code, { pick: e.target.checked })} className="h-4 w-4" aria-label={`Add ${p.code}`} />
                  </td>
                  <td className="py-2 pr-3 font-mono font-bold">{p.code}</td>
                  <td className="py-2 pr-3">
                    <input value={r.name} onChange={(e) => set(p.code, { name: e.target.value })} className={`${inputClass} !py-1.5`} placeholder="Full name" />
                  </td>
                  <td className="py-2 pr-3 text-black/60">
                    {[p.designation, p.department].filter(Boolean).join(" · ") || "—"}
                    {p.status && !/work|active/i.test(p.status) ? <span className="ml-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">{p.status}</span> : null}
                  </td>
                  <td className="py-2 pr-3">
                    <select value={r.store} onChange={(e) => set(p.code, { store: e.target.value })} className={`${inputClass} !py-1.5`}>
                      <option value="">Choose…</option>
                      {storeChoices.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <select value={r.role} onChange={(e) => set(p.code, { role: e.target.value })} className={`${inputClass} !py-1.5`}>
                      {ADDABLE.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 text-black/60">
                    {formatDateTime(p.lastPunch)}
                    <span className="block text-xs text-black/40">{p.punches} punches</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={add} disabled={busy || picked.length === 0} className="rounded-xl bg-[#161616] px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
          {busy ? "Adding…" : `Add ${picked.length || ""} to the app`.replace("  ", " ")}
        </button>
        {result && <p className="text-sm font-semibold text-green-700">{result}</p>}
      </div>
      <ErrorBox message={error} />
    </div>
  );
}
