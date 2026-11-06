"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorBox, inputClass } from "@/components/SiteChrome";
import { ASSIGNABLE_ROLES, ROLE_HELP, ROLE_LABELS, type Role } from "@/lib/roles";
import { SECTIONS, type AccessConfig, type CustomRole, type RoleAccess, type Section } from "@/lib/access";

const BUILT_IN = ASSIGNABLE_ROLES.filter((r) => r !== "super_admin");
const COLOURS = ["#ff5e79", "#8883d7", "#0fa8bf", "#f39237"];

function same(a: RoleAccess, b: RoleAccess) {
  return a.allStores === b.allStores && a.sections.length === b.sections.length && a.sections.every((s) => b.sections.includes(s));
}

function SectionChips({ value, onChange }: { value: RoleAccess; onChange: (v: RoleAccess) => void }) {
  const toggle = (k: Section) =>
    onChange({ ...value, sections: value.sections.includes(k) ? value.sections.filter((s) => s !== k) : [...value.sections, k] });
  return (
    <div className="flex flex-wrap gap-1.5">
      {SECTIONS.map((s) => {
        const on = value.sections.includes(s.key);
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => toggle(s.key)}
            aria-pressed={on}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              on ? "bg-[#161616] text-white" : "bg-[#f7f9fb] text-black/45 ring-1 ring-black/10 hover:text-black"
            }`}
          >
            {on ? "✓ " : ""}
            {s.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onChange({ ...value, allStores: !value.allStores })}
        aria-pressed={value.allStores}
        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
          value.allStores ? "bg-[#0fa8bf] text-white" : "bg-[#f7f9fb] text-black/45 ring-1 ring-black/10 hover:text-black"
        }`}
      >
        {value.allStores ? "✓ All stores" : "Own store only"}
      </button>
    </div>
  );
}

export default function RolesAccessPage() {
  const [config, setConfig] = useState<AccessConfig | null>(null);
  const [defaults, setDefaults] = useState<Record<string, RoleAccess>>({});
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);
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

  const builtinAccess = useMemo(
    () => (r: Role): RoleAccess => config?.builtin[r] ?? defaults[r] ?? { sections: [], allStores: false },
    [config, defaults]
  );

  const update = (next: AccessConfig) => {
    setConfig(next);
    setDirty(true);
    setNotice("");
  };

  const setBuiltin = (r: Role, v: RoleAccess) => {
    if (!config) return;
    const builtin = { ...config.builtin };
    if (defaults[r] && same(v, defaults[r])) delete builtin[r];
    else builtin[r] = v;
    update({ ...config, builtin });
  };

  const setCustom = (id: string, change: Partial<CustomRole>) => {
    if (!config) return;
    update({ ...config, custom: config.custom.map((c) => (c.id === id ? { ...c, ...change } : c)) });
  };

  const addCustom = () => {
    if (!config) return;
    const id = `r${Date.now().toString(36)}`;
    update({
      ...config,
      custom: [...config.custom, { id, name: "", baseRole: "csa", ...(defaults.csa ?? { sections: [], allStores: false }) }],
    });
  };

  const save = async () => {
    if (!config) return;
    if (config.custom.some((c) => !c.name.trim())) return setError("Give every custom role a name.");
    setSaving(true);
    setError("");
    const res = await fetch("/api/staff/admin/roles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setSaving(false);
    if (!res?.ok) return setError(d.error || "Unable to save.");
    setConfig(d.config);
    setDirty(false);
    setNotice("Saved. Changes apply straight away.");
  };

  const card = "rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5";

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-3xl font-bold">Roles &amp; Access</h1>
        <p className="mt-2 max-w-3xl text-sm text-black/60">
          Choose which sections each role can open, and whether it sees all stores or only its own. Create new roles for
          other jobs. Who receives complaints, escalations and approvals still follows the built-in role (for a new role,
          the role it “works like”). Settings pages stay with the Super Admin and Admins. The Super Admin always has full
          access.
        </p>
      </div>

      <ErrorBox message={error} />
      {notice && <p className="rounded-2xl bg-green-50 p-3 text-sm font-semibold text-green-800">{notice}</p>}
      {!config && !error && <div className="h-40 animate-pulse rounded-3xl bg-white" />}

      {config && (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="text-lg font-bold">Your roles</h2>
              <button type="button" onClick={addCustom} className="rounded-2xl bg-[#161616] px-4 py-2.5 text-sm font-bold text-white">
                + New role
              </button>
            </div>
            {config.custom.length === 0 && (
              <p className={`${card} text-sm text-black/55`}>No roles of your own yet. Tap “New role” to create one, e.g. Area Manager.</p>
            )}
            {config.custom.map((c, i) => (
              <div key={c.id} className={`${card} relative overflow-hidden`}>
                <span className="absolute inset-y-4 left-0 w-1 rounded-r-full" style={{ backgroundColor: COLOURS[i % COLOURS.length] }} />
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-black/55">Role name</span>
                    <input value={c.name} onChange={(e) => setCustom(c.id, { name: e.target.value })} className={inputClass} placeholder="e.g. Area Manager" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-black/55">Works like (routing &amp; approvals)</span>
                    <select value={c.baseRole} onChange={(e) => setCustom(c.id, { baseRole: e.target.value as Role })} className={inputClass}>
                      {BUILT_IN.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if ((usage[`custom:${c.id}`] ?? 0) > 0) return setError(`"${c.name}" is given to ${usage[`custom:${c.id}`]} staff. Change their role first.`);
                      update({ ...config, custom: config.custom.filter((x) => x.id !== c.id) });
                    }}
                    className="rounded-xl px-3 py-2.5 text-sm font-semibold text-red-700 ring-1 ring-red-200"
                  >
                    Delete
                  </button>
                </div>
                <p className="mt-2 text-xs text-black/45">
                  {usage[`custom:${c.id}`] ?? 0} staff · {ROLE_HELP[c.baseRole]}
                </p>
                <div className="mt-3">
                  <SectionChips value={c} onChange={(v) => setCustom(c.id, v)} />
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold">Built-in roles</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {BUILT_IN.map((r, i) => {
                const v = builtinAccess(r);
                const changed = Boolean(config.builtin[r]);
                return (
                  <div key={r} className={`${card} relative overflow-hidden`}>
                    <span className="absolute inset-y-4 left-0 w-1 rounded-r-full" style={{ backgroundColor: COLOURS[i % COLOURS.length] }} />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-bold">
                        {ROLE_LABELS[r]} <span className="text-xs font-semibold text-black/40">· {usage[r] ?? 0} staff</span>
                      </p>
                      {changed && (
                        <button type="button" onClick={() => setBuiltin(r, defaults[r])} className="text-xs font-semibold text-[#0b7f90] hover:underline">
                          Reset to default
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-black/45">{ROLE_HELP[r]}</p>
                    <div className="mt-3">
                      <SectionChips value={v} onChange={(nv) => setBuiltin(r, nv)} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {dirty && (
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 sm:bottom-6">
          <div className="flex items-center gap-3 rounded-2xl bg-[#161616] px-4 py-3 text-white shadow-xl">
            <span className="text-sm">You have unsaved changes</span>
            <button type="button" onClick={save} disabled={saving} className="rounded-xl bg-[#ff5e79] px-4 py-2 text-sm font-bold disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
