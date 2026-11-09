"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ErrorBox, inputClass, labelClass } from "@/components/SiteChrome";
import { formatDateTime } from "@/lib/helpers";
import { ASSIGNABLE_ROLES, ROLE_HELP, ROLE_LABELS, type Role } from "@/lib/roles";
import { SECTIONS, type Section } from "@/lib/access";

type StaffRow = {
  id: string;
  user_id: string;
  full_name: string;
  role: Role;
  store_name: string | null;
  director_stores: string[] | null;
  email: string | null;
  whatsapp_number: string | null;
  notify_email: boolean;
  notify_whatsapp: boolean;
  is_active: boolean;
  last_login_at: string | null;
  custom_role_id?: string | null;
  can_edit_warranties?: boolean | null;
  extra_sections?: Section[] | null;
};

type CustomRoleOption = { id: string; name: string; baseRole: Role };

const STORE_ROLES: Role[] = ["store_manager", "technician", "csa", "floor_incharge"];

type StoreOption = { name: string; code: string | null };

const storeLabel = (s: StoreOption) => (s.code ? `${s.name} (${s.code})` : s.name);

export default function StaffUsersPage() {
  const [users, setUsers] = useState<StaffRow[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeSource, setStoreSource] = useState("zoho");
  const [storeError, setStoreError] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentRole, setCurrentRole] = useState<Role>("admin");
  const [customRoles, setCustomRoles] = useState<CustomRoleOption[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  const [fullName, setFullName] = useState("");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("csa");
  const [newCustomRole, setNewCustomRole] = useState("");
  const [storeName, setStoreName] = useState("");
  const [directorStores, setDirectorStores] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/staff/admin/users");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setErrorMessage(data.error || "Unable to load staff.");
    else {
      setUsers(data.users ?? []);
      setStores(data.stores ?? []);
      setStoreSource(data.storeSource ?? "zoho");
      setStoreError(data.storeError ?? "");
      setCurrentUserId(data.currentUserId ?? "");
      setCurrentRole(data.currentRole ?? "admin");
      setCustomRoles(data.customRoles ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const run = async () => {
      await load();
    };
    run();
  }, [load]);

  const isSuper = currentRole === "super_admin";
  const PROTECTED: Role[] = ["super_admin", "admin", "director"];
  const assignableRoles = ASSIGNABLE_ROLES.filter((r) => isSuper || !PROTECTED.includes(r));

  const patch = async (id: string, change: Record<string, unknown>, success: string) => {
    setErrorMessage("");
    setNotice("");
    const response = await fetch("/api/staff/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...change }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setErrorMessage(data.error || "Unable to update.");
    else setNotice(success);
    load();
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setNotice("");
    setSaving(true);
    const response = await fetch("/api/staff/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, userId, password, role, customRoleId: newCustomRole, storeName, directorStores, email, whatsappNumber }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setErrorMessage(data.error || "Unable to create the staff user.");
      return;
    }
    setNotice(`Staff user "${userId.trim().toLowerCase()}" created. Share the password with them privately.`);
    setFullName("");
    setUserId("");
    setPassword("");
    setRole("csa");
    setNewCustomRole("");
    setStoreName("");
    setDirectorStores([]);
    setEmail("");
    setWhatsappNumber("");
    load();
  };

  const resetPassword = (user: StaffRow) => {
    const newPassword = window.prompt(
      `New password for ${user.full_name} (${user.user_id}).\nAt least 8 characters with letters and numbers:`
    );
    if (!newPassword) return;
    patch(user.id, { newPassword }, `Password changed for ${user.user_id}. They have been logged out.`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Staff Users</h1>
        <p className="mt-2 text-sm text-black/60">
          Add staff with their role and store. Add an e-mail and WhatsApp number so they get alerts for new
          service requests and complaints. Stores come from Zoho POS automatically (new Zoho stores appear here on
          their own), plus CORPORATE OFFICE.
        </p>
        {storeSource !== "zoho" && (
          <p className="mt-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
            Zoho POS is not connected, so the old store list is shown. Connect Zoho POS to use the Zoho store names.
          </p>
        )}
        {storeError && (
          <p className="mt-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
            Could not refresh the store list from Zoho just now — showing the last saved list. ({storeError})
          </p>
        )}
      </div>

      <form onSubmit={create} className="grid gap-4 rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor="fn" className={labelClass}>Full Name *</label>
          <input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="uid" className={labelClass}>User ID *</label>
          <input id="uid" autoCapitalize="none" inputMode="numeric" value={userId} onChange={(e) => setUserId(e.target.value)} className={inputClass} placeholder="4-digit number, e.g. 1010" />
        </div>
        <div>
          <label htmlFor="pw" className={labelClass}>Password *</label>
          <input id="pw" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="8+ chars, letters & numbers" />
        </div>
        <div>
          <label htmlFor="role" className={labelClass}>Role *</label>
          <select
            id="role"
            value={newCustomRole ? `custom:${newCustomRole}` : role}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("custom:")) {
                const c = customRoles.find((x) => x.id === v.slice(7));
                setNewCustomRole(c?.id ?? "");
                if (c) setRole(c.baseRole);
              } else {
                setNewCustomRole("");
                setRole(v as Role);
              }
            }}
            className={inputClass}
          >
            {assignableRoles.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
            {isSuper && customRoles.length > 0 && (
              <optgroup label="Custom roles">
                {customRoles.map((c) => (
                  <option key={c.id} value={`custom:${c.id}`}>{c.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="mt-1 text-xs text-black/50">
            {newCustomRole ? `Custom role — works like ${ROLE_LABELS[role]}. Access is set in Roles & Access.` : ROLE_HELP[role]}
          </p>
        </div>
        <div>
          <label htmlFor="store" className={labelClass}>
            {role === "director" ? "CORPORATE OFFICE · looks after" : "Store"}{STORE_ROLES.includes(role) ? " *" : ""}
          </label>
          {role === "director" ? (
            <div className="space-y-1 rounded-2xl border border-black/10 bg-white p-3 text-sm">
              {stores
                .filter((s) => s.name !== "CORPORATE OFFICE")
                .map((s) => (
                  <label key={s.name} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={directorStores.includes(s.name)}
                      onChange={(e) =>
                        setDirectorStores((list) => (e.target.checked ? [...list, s.name] : list.filter((x) => x !== s.name)))
                      }
                    />
                    {storeLabel(s)}
                  </label>
                ))}
              <p className="text-xs text-black/45">Tick every store this Director looks after (none = all stores).</p>
            </div>
          ) : (
            <select id="store" value={storeName} onChange={(e) => setStoreName(e.target.value)} className={inputClass}>
              <option value="">— No store —</option>
              {stores.map((s) => (
                <option key={s.name} value={s.name}>{storeLabel(s)}</option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>E-mail (for alerts)</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="name@sevenyears.in" />
        </div>
        <div>
          <label htmlFor="wa" className={labelClass}>WhatsApp (for alerts)</label>
          <input id="wa" type="tel" inputMode="numeric" maxLength={10} value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} className={inputClass} placeholder="10-digit mobile" />
        </div>
        <div className="flex items-end sm:col-span-2 lg:col-span-2">
          <button type="submit" disabled={saving} className="w-full rounded-2xl bg-[#ff5e79] px-5 py-3 font-bold text-white disabled:opacity-50">
            {saving ? "Creating..." : "Add Staff User"}
          </button>
        </div>
      </form>

      <ErrorBox message={errorMessage} />
      {notice && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">{notice}</div>
      )}

      <div className="overflow-hidden rounded-3xl bg-white soft-card ring-1 ring-black/5">
        {loading ? (
          <p className="p-5 text-sm text-black/60">Loading...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="bg-[#f7f9fb] text-xs uppercase tracking-wider text-black/45">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Store</th>
                  <th className="px-4 py-3">Alerts to</th>
                  <th className="px-4 py-3">Last Login</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {users.map((u) => {
                  const self = u.id === currentUserId;
                  const locked = !isSuper && !self && PROTECTED.includes(u.role);
                  if (editing === u.id)
                    return (
                      <EditStaffRow
                        key={u.id}
                        user={u}
                        self={self}
                        isSuper={isSuper}
                        stores={stores}
                        customRoles={customRoles}
                        roleOptions={(isSuper ? ASSIGNABLE_ROLES : ASSIGNABLE_ROLES.filter((r) => !PROTECTED.includes(r)))
                          .concat([u.role])
                          .filter((r, i, all) => all.indexOf(r) === i)}
                        onCancel={() => setEditing(null)}
                        onSaved={(msg) => {
                          setEditing(null);
                          setErrorMessage("");
                          setNotice(msg);
                          load();
                        }}
                        onError={(msg) => setErrorMessage(msg)}
                      />
                    );
                  const custom = u.custom_role_id ? customRoles.find((c) => c.id === u.custom_role_id) : undefined;
                  return (
                    <tr key={u.id} className={`${u.is_active ? "" : "opacity-50"} ${editing ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">
                          {u.full_name}
                          {self && <span className="ml-2 text-xs text-black/40">(you)</span>}
                        </p>
                        <p className="font-mono text-xs text-black/50">{u.user_id}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{custom?.name ?? ROLE_LABELS[u.role]}</p>
                        {custom && <p className="text-[11px] text-black/45">Works like {ROLE_LABELS[custom.baseRole]}</p>}
                        {u.role === "store_manager" && !u.custom_role_id && u.can_edit_warranties === false && (
                          <p className="text-[11px] font-semibold text-red-700">Warranty editing suspended</p>
                        )}
                        {(u.extra_sections?.length ?? 0) > 0 && (
                          <p className="text-[11px] text-[#0b7f90]">
                            + {u.extra_sections!.map((k) => SECTIONS.find((x) => x.key === k)?.label ?? k).join(", ")}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {u.role === "director" ? (
                          <>
                            <p className="font-bold">CORPORATE OFFICE</p>
                            <p className="text-black/60">Looks after: {u.director_stores?.length ? u.director_stores.join(", ") : "all stores"}</p>
                          </>
                        ) : (
                          <p className="font-semibold">{u.store_name || <span className="text-black/40">No store</span>}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <p className={u.notify_email && u.email ? "" : "text-black/35"}>
                          {u.notify_email && u.email ? "✓ " : "✗ "}
                          {u.email || "No e-mail"}
                        </p>
                        <p className={`mt-1 ${u.notify_whatsapp && u.whatsapp_number ? "" : "text-black/35"}`}>
                          {u.notify_whatsapp && u.whatsapp_number ? "✓ " : "✗ "}
                          {u.whatsapp_number ? `WA ${u.whatsapp_number}` : "No WhatsApp"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-black/55">
                        {u.last_login_at ? formatDateTime(u.last_login_at) : "Never"}
                      </td>
                      <td className="px-4 py-3">
                        {!locked && (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={Boolean(editing)}
                              onClick={() => {
                                setNotice("");
                                setErrorMessage("");
                                setEditing(u.id);
                              }}
                              className="rounded-xl bg-[#161616] px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
                            >
                              Edit
                            </button>
                            <button type="button" disabled={Boolean(editing)} onClick={() => resetPassword(u)} className="rounded-xl border border-black/10 px-3 py-1 text-xs font-bold hover:bg-[#f7f9fb] disabled:opacity-40">
                              Reset password
                            </button>
                            {!self && (
                              <button
                                type="button"
                                disabled={Boolean(editing)}
                                onClick={() => {
                                  if (!confirm(`${u.is_active ? "Disable" : "Enable"} ${u.full_name}?`)) return;
                                  patch(u.id, { isActive: !u.is_active }, u.is_active ? `${u.user_id} disabled.` : `${u.user_id} enabled.`);
                                }}
                                className={`rounded-xl px-3 py-1 text-xs font-bold disabled:opacity-40 ${u.is_active ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}
                              >
                                {u.is_active ? "Disable" : "Enable"}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-3xl bg-white p-5 text-sm soft-card ring-1 ring-black/5">
        <p className="font-bold">Who gets what</p>
        <ul className="mt-2 space-y-1 text-black/60">
          {ASSIGNABLE_ROLES.map((r) => (
            <li key={r}>
              <span className="font-semibold text-black/80">{ROLE_LABELS[r]}:</span> {ROLE_HELP[r]}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type EditProps = {
  user: StaffRow;
  self: boolean;
  isSuper: boolean;
  stores: StoreOption[];
  customRoles: CustomRoleOption[];
  roleOptions: Role[];
  onCancel: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
};

/** Edit one staff member — nothing changes until Save. */
function EditStaffRow({ user: u, self, isSuper, stores, customRoles, roleOptions, onCancel, onSaved, onError }: EditProps) {
  const startRole = u.custom_role_id ? `custom:${u.custom_role_id}` : u.role;
  const [fullName, setFullName] = useState(u.full_name);
  const [roleValue, setRoleValue] = useState(startRole);
  const [store, setStore] = useState(u.store_name ?? "");
  const [dStores, setDStores] = useState<string[]>(u.director_stores ?? []);
  const [email, setEmail] = useState(u.email ?? "");
  const [wa, setWa] = useState(u.whatsapp_number ?? "");
  const [notifyEmail, setNotifyEmail] = useState(u.notify_email);
  const [notifyWa, setNotifyWa] = useState(u.notify_whatsapp);
  const [canEdit, setCanEdit] = useState(u.can_edit_warranties !== false);
  const [extra, setExtra] = useState<Section[]>(u.extra_sections ?? []);
  const [busy, setBusy] = useState(false);

  const custom = roleValue.startsWith("custom:") ? customRoles.find((c) => c.id === roleValue.slice(7)) : undefined;
  const effectiveRole: Role = custom ? custom.baseRole : (roleValue as Role);
  const canChangeRole = !self && (isSuper || !u.custom_role_id);
  const showAccess = isSuper && !self && u.role !== "super_admin";

  const send = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/staff/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, ...body }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) throw new Error(d.error || "Unable to save.");
  };

  const save = async () => {
    if (!fullName.trim()) return onError("Enter the name.");
    setBusy(true);
    try {
      // 1. Role first (it can move a Director to CORPORATE OFFICE).
      if (roleValue !== startRole) {
        if (custom) await send({ customRoleId: custom.id });
        else await send({ role: roleValue, clearCustom: Boolean(u.custom_role_id) });
      }
      // 2. Everything else that changed.
      const body: Record<string, unknown> = {};
      if (fullName.trim() !== u.full_name) body.fullName = fullName.trim();
      if (effectiveRole === "director") {
        const before = [...(u.director_stores ?? [])].sort().join("|");
        if ([...dStores].sort().join("|") !== before) body.directorStores = dStores;
      } else if (store !== (u.store_name ?? "")) body.storeName = store;
      if (email.trim() !== (u.email ?? "")) body.email = email.trim();
      if (wa.trim() !== (u.whatsapp_number ?? "")) body.whatsappNumber = wa.trim();
      if (notifyEmail !== u.notify_email) body.notifyEmail = notifyEmail;
      if (notifyWa !== u.notify_whatsapp) body.notifyWhatsapp = notifyWa;
      if (isSuper && effectiveRole === "store_manager" && canEdit !== (u.can_edit_warranties !== false)) body.canEditWarranties = canEdit;
      if (showAccess && [...extra].sort().join("|") !== [...(u.extra_sections ?? [])].sort().join("|")) body.extraSections = extra;
      if (Object.keys(body).length) await send(body);
      onSaved(`${fullName.trim()} saved.${roleValue !== startRole ? " The new role applies from their next login." : ""}`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  };

  const field = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-black/45";
  const box = "w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm";

  return (
    <tr className="bg-[#fff8f9]">
      <td colSpan={6} className="px-4 py-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className={field}>Full name</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={box} />
            <span className="mt-1 block font-mono text-[11px] text-black/45">User ID {u.user_id}</span>
          </label>
          <label className="block">
            <span className={field}>Role</span>
            <select value={roleValue} disabled={!canChangeRole} onChange={(e) => setRoleValue(e.target.value)} className={`${box} disabled:opacity-60`}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
              {(isSuper || u.custom_role_id) && customRoles.length > 0 && (
                <optgroup label="Custom roles">
                  {customRoles
                    .filter((c) => isSuper || c.id === u.custom_role_id)
                    .map((c) => (
                      <option key={c.id} value={`custom:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
            {self && <span className="mt-1 block text-[11px] text-black/45">You can&apos;t change your own role.</span>}
            {isSuper && effectiveRole === "store_manager" && !custom && (
              <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
                <input type="checkbox" checked={canEdit} onChange={(e) => setCanEdit(e.target.checked)} />
                Can edit warranties
              </label>
            )}
          </label>
          <div>
            <span className={field}>{effectiveRole === "director" ? "Corporate office · looks after" : "Store"}</span>
            {effectiveRole === "director" ? (
              <div className="space-y-1 rounded-xl border border-black/10 bg-white p-2 text-xs">
                {stores
                  .filter((s) => s.name !== "CORPORATE OFFICE")
                  .map((s) => (
                    <label key={s.name} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={dStores.includes(s.name)}
                        onChange={(e) => setDStores((l) => (e.target.checked ? [...l, s.name] : l.filter((x) => x !== s.name)))}
                      />
                      {storeLabel(s)}
                    </label>
                  ))}
                <p className="text-[11px] text-black/45">None ticked = all stores.</p>
              </div>
            ) : (
              <select value={store} onChange={(e) => setStore(e.target.value)} className={box}>
                <option value="">— No store —</option>
                {store && !stores.some((s) => s.name === store) && <option value={store}>{store} (not in Zoho — please change)</option>}
                {stores.map((s) => (
                  <option key={s.name} value={s.name}>
                    {storeLabel(s)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="space-y-2">
            <span className={field}>Alerts to</span>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} aria-label="E-mail alerts on" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={box} placeholder="name@sevenyears.in" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notifyWa} onChange={(e) => setNotifyWa(e.target.checked)} aria-label="WhatsApp alerts on" />
              <input type="tel" inputMode="numeric" maxLength={10} value={wa} onChange={(e) => setWa(e.target.value)} className={box} placeholder="WhatsApp, 10 digits" />
            </label>
          </div>
        </div>

        {showAccess && (
          <div className="mt-4">
            <span className={field}>Extra access (on top of the role)</span>
            <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl bg-white p-3 text-xs ring-1 ring-black/10">
              {SECTIONS.map((sec) => (
                <label key={sec.key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={extra.includes(sec.key)}
                    onChange={(e) => setExtra((l) => (e.target.checked ? [...l, sec.key] : l.filter((k) => k !== sec.key)))}
                  />
                  {sec.label}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={busy} className="rounded-xl bg-[#ff5e79] px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-xl px-5 py-2 text-sm font-bold ring-1 ring-black/10">
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}
