"use client";

import { Fragment, useEffect, useState } from "react";
import { ErrorBox, inputClass } from "@/components/SiteChrome";
import { ASSIGNABLE_ROLES, ROLE_HELP, ROLE_LABELS, type Role } from "@/lib/roles";
import { SECTIONS, type AccessConfig, type CustomRole, type RoleAccess, type Section } from "@/lib/access";

const BUILT_IN: Role[] = ASSIGNABLE_ROLES.filter((r) => r !== "super_admin");
const isBuiltIn = (k: string): k is Role => (BUILT_IN as string[]).includes(k);

function same(a: RoleAccess, b: RoleAccess) {
  return a.allStores === b.allStores && a.sections.length === b.sections.length && a.sections.every((s) => b.sections.includes(s));
}

/** One row of the list: a built-in role or a role you created. */
type Row = { key: string; kind: "builtin" | "custom"; name: string; baseRole: Role; access: RoleAccess; staff: number };

type Draft = { key: string; isNew: boolean; name: string; baseRole: Role; access: RoleAccess };

const tick = "h-5 w-5 cursor-pointer accent-[#161616]";
const DOTS = ["#ff5e79", "#8883d7", "#0fa8bf", "#f39237"];

function Yes() {
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-100 text-sm font-black text-green-700" aria-label="Yes">
      ✓
    </span>
  );
}
function No() {
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-black/15" aria-label="No" />;
}

export default function RolesAccessPage() {
  const [config, setConfig] = useState<AccessConfig | null>(null);
  const [defaults, setDefaults] = useState<Record<string, RoleAccess>>({});
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/staff/admin/roles", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return setError(d.error || "Unable to load.");
        setConfig(d.config);
        setDefaults(d.defaults ?? {});
        setUsage(d.usage ?? {});
      })
      .catch(() => setError("Unable to load."));
  }, []);

  const builtinAccess = (r: Role): RoleAccess => config?.builtin[r] ?? defaults[r] ?? { sections: [], allStores: false };

  // All roles in one list: built-in first (in their usual order), then the ones you created.
  const rows: Row[] = config
    ? [
        ...BUILT_IN.map((r) => ({ key: r, kind: "builtin" as const, name: ROLE_LABELS[r], baseRole: r, access: builtinAccess(r), staff: usage[r] ?? 0 })),
        ...config.custom.map((c) => ({
          key: c.id,
          kind: "custom" as const,
          name: c.name,
          baseRole: c.baseRole,
          access: { sections: c.sections, allStores: c.allStores },
          staff: usage[`custom:${c.id}`] ?? 0,
        })),
      ]
    : [];

  const save = async (next: AccessConfig, message: string) => {
    setSaving(true);
    setError("");
    setNotice("");
    const res = await fetch("/api/staff/admin/roles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: next }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setSaving(false);
    if (!res?.ok) {
      setError(d.error || "Unable to save.");
      return false;
    }
    setConfig(d.config);
    setNotice(message);
    return true;
  };

  const startEdit = (row: Row) => {
    setNotice("");
    setError("");
    setDraft({ key: row.key, isNew: false, name: row.name, baseRole: row.baseRole, access: { ...row.access, sections: [...row.access.sections] } });
  };

  const startNew = () => {
    setNotice("");
    setError("");
    const base = defaults.csa ?? { sections: [], allStores: false };
    setDraft({ key: `r${Date.now().toString(36)}`, isNew: true, name: "", baseRole: "csa", access: { ...base, sections: [...base.sections] } });
  };

  const saveDraft = async () => {
    if (!config || !draft) return;
    const builtinRow = isBuiltIn(draft.key);
    let next: AccessConfig;
    if (builtinRow) {
      const r = draft.key as Role;
      const builtin = { ...config.builtin };
      if (defaults[r] && same(draft.access, defaults[r])) delete builtin[r];
      else builtin[r] = draft.access;
      next = { ...config, builtin };
    } else {
      const name = draft.name.trim();
      if (!name) return setError("Give the role a name.");
      if (rows.some((x) => x.key !== draft.key && x.name.toLowerCase() === name.toLowerCase())) return setError(`There is already a role called "${name}".`);
      const role: CustomRole = { id: draft.key, name, baseRole: draft.baseRole, ...draft.access };
      next = draft.isNew
        ? { ...config, custom: [...config.custom, role] }
        : { ...config, custom: config.custom.map((c) => (c.id === draft.key ? role : c)) };
    }
    if (await save(next, `"${builtinRow ? ROLE_LABELS[draft.key as Role] : draft.name.trim()}" saved. Changes apply straight away.`)) setDraft(null);
  };

  const remove = async (row: Row) => {
    if (!config) return;
    if (row.staff > 0) return setError(`"${row.name}" is given to ${row.staff} staff. Change their role first.`);
    if (!confirm(`Delete the role "${row.name}"?`)) return;
    await save({ ...config, custom: config.custom.filter((c) => c.id !== row.key) }, `"${row.name}" deleted.`);
  };

  const resetDefault = async (row: Row) => {
    if (!config || !confirm(`Put "${row.name}" back to its standard access?`)) return;
    const builtin = { ...config.builtin };
    if (isBuiltIn(row.key)) delete builtin[row.key];
    await save({ ...config, builtin }, `"${row.name}" is back to its standard access.`);
  };

  const toggleSection = (k: Section) =>
    draft &&
    setDraft({
      ...draft,
      access: { ...draft.access, sections: draft.access.sections.includes(k) ? draft.access.sections.filter((s) => s !== k) : [...draft.access.sections, k] },
    });

  const th = "whitespace-nowrap px-2 py-3 text-[11px] font-bold uppercase tracking-wide text-black/45";
  const cols = SECTIONS.length + 3;

  const editRow = (d: Draft) => {
    const builtinRow = isBuiltIn(d.key);
    return (
      <tr key={`edit-${d.key}`} className="bg-[#fff8f9]">
        <td className="px-4 py-3 align-top">
          {builtinRow ? (
            <p className="font-bold">{ROLE_LABELS[d.key as Role]}</p>
          ) : (
            <div className="space-y-2">
              <input autoFocus value={d.name} onChange={(e) => setDraft({ ...d, name: e.target.value })} className={`${inputClass} py-2`} placeholder="Role name, e.g. Area Manager" />
              <label className="block text-[11px] font-semibold text-black/50">
                Works like (who gets complaints, approvals)
                <select value={d.baseRole} onChange={(e) => setDraft({ ...d, baseRole: e.target.value as Role })} className={`${inputClass} mt-1 py-2`}>
                  {BUILT_IN.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </td>
        {SECTIONS.map((s) => (
          <td key={s.key} className="px-2 py-2.5 text-center align-top">
            <input type="checkbox" className={tick} checked={d.access.sections.includes(s.key)} onChange={() => toggleSection(s.key)} aria-label={s.label} />
          </td>
        ))}
        <td className="px-2 py-2.5 text-center align-top">
          <input
            type="checkbox"
            className="h-5 w-5 cursor-pointer accent-[#0fa8bf]"
            checked={d.access.allStores}
            onChange={() => setDraft({ ...d, access: { ...d.access, allStores: !d.access.allStores } })}
            aria-label="All stores"
          />
        </td>
        <td className="px-4 py-3 align-top">
          <div className="flex flex-col gap-2">
            <button type="button" onClick={saveDraft} disabled={saving} className="rounded-xl bg-[#ff5e79] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setDraft(null)} disabled={saving} className="rounded-xl px-4 py-2 text-xs font-bold ring-1 ring-black/10">
              Cancel
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Roles &amp; Access</h1>
          <p className="mt-2 max-w-3xl text-sm text-black/60">
            Tick the sections each role can open, and whether it sees all stores or only its own. Tap <b>Edit</b> to change a role.
            Who receives complaints, escalations and approvals follows the built-in role (for a role you create, the role it “works
            like”). Settings pages stay with the Super Admin and Admins; the Super Admin always has full access.
          </p>
        </div>
        <button type="button" onClick={startNew} disabled={!config || Boolean(draft)} className="rounded-2xl bg-[#161616] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
          + New role
        </button>
      </div>

      <ErrorBox message={error} />
      {notice && <p className="rounded-2xl bg-green-50 p-3 text-sm font-semibold text-green-800">{notice}</p>}
      {!config && !error && <div className="h-40 animate-pulse rounded-3xl bg-white" />}

      {config && (
        <div className="overflow-x-auto rounded-3xl bg-white soft-card ring-1 ring-black/5">
          <div className="h-1.5 bg-[linear-gradient(90deg,#ff5e79,#8883d7,#f39237,#0fa8bf)]" aria-hidden />
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b border-black/5">
              <tr>
                <th className={`${th} w-[230px] pl-6 text-left`}>Role</th>
                {SECTIONS.map((s) => (
                  <th key={s.key} className={`${th} w-[88px] whitespace-normal text-center leading-tight`}>
                    {s.label}
                  </th>
                ))}
                <th className={`${th} w-[96px] whitespace-normal text-center leading-tight`}>Stores</th>
                <th className={`${th} text-left`}> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {rows.map((row, idx) =>
                draft && !draft.isNew && draft.key === row.key ? (
                  editRow(draft)
                ) : (
                  <Fragment key={row.key}>
                    <tr className={`transition hover:bg-[#fafbfd] ${draft ? "opacity-50" : ""}`}>
                      <td className="py-3 pl-6 pr-3">
                        <div className="flex items-center gap-3">
                          <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: DOTS[idx % DOTS.length] }} aria-hidden />
                          <div>
                        <p className="font-bold leading-tight">
                          {row.name}
                          {row.kind === "custom" && (
                            <span className="ml-2 rounded-full bg-[#8883d7]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[#5d58b5]">Custom</span>
                          )}
                          {row.kind === "builtin" && isBuiltIn(row.key) && config.builtin[row.key] && (
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">Changed</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-[11px] text-black/45">
                          {row.staff} staff{row.kind === "custom" ? ` · works like ${ROLE_LABELS[row.baseRole]}` : ""}
                        </p>
                          </div>
                        </div>
                      </td>
                      {SECTIONS.map((s) => (
                        <td key={s.key} className="px-2 py-2.5 text-center">
                          {row.access.sections.includes(s.key) ? <Yes /> : <No />}
                        </td>
                      ))}
                      <td className="px-2 py-2.5 text-center">
                        {row.access.allStores ? (
                          <span className="rounded-full bg-[#0fa8bf]/15 px-2.5 py-1 text-[11px] font-bold text-[#0b7f90]">All</span>
                        ) : (
                          <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-semibold text-black/50">Own</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            disabled={Boolean(draft) || saving}
                            className="rounded-xl px-3 py-1.5 text-xs font-bold ring-1 ring-black/15 transition hover:bg-[#161616] hover:text-white disabled:opacity-40"
                          >
                            ✎ Edit
                          </button>
                          {row.kind === "custom" && (
                            <button
                              type="button"
                              onClick={() => remove(row)}
                              disabled={Boolean(draft) || saving}
                              className="rounded-xl px-3 py-1.5 text-xs font-bold text-red-700 ring-1 ring-red-200 disabled:opacity-40"
                            >
                              Delete
                            </button>
                          )}
                          {row.kind === "builtin" && isBuiltIn(row.key) && config.builtin[row.key] && (
                            <button
                              type="button"
                              onClick={() => resetDefault(row)}
                              disabled={Boolean(draft) || saving}
                              className="text-xs font-semibold text-[#0b7f90] hover:underline disabled:opacity-40"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                )
              )}
              {draft?.isNew && editRow(draft)}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cols} className="px-4 py-6 text-center text-sm text-black/50">
                    No roles.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {config && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">What each role does</h2>
          <p className="text-sm text-black/55">
            This decides who receives complaints, escalations and approvals. A role you create works like the built-in role you choose for it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BUILT_IN.map((r, i) => (
              <div key={r} className="relative overflow-hidden rounded-2xl bg-white p-4 soft-card ring-1 ring-black/5">
                <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: DOTS[i % DOTS.length] }} aria-hidden />
                <p className="text-sm font-bold">{ROLE_LABELS[r]}</p>
                <p className="mt-1 text-xs leading-5 text-black/55">{ROLE_HELP[r]}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
