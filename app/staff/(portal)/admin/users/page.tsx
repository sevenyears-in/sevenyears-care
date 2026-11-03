"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ErrorBox, inputClass, labelClass } from "@/components/SiteChrome";
import { formatDateTime } from "@/lib/helpers";
import { ASSIGNABLE_ROLES, ROLE_HELP, ROLE_LABELS, type Role } from "@/lib/roles";

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
};

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
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  const [fullName, setFullName] = useState("");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("csa");
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
      body: JSON.stringify({ fullName, userId, password, role, storeName, directorStores, email, whatsappNumber }),
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
    setStoreName("");
    setDirectorStores([]);
    setEmail("");
    setWhatsappNumber("");
    load();
  };

  const ask = (user: StaffRow, label: string, current: string | null, field: string) => {
    const value = window.prompt(`${label} for ${user.full_name}:`, current ?? "");
    if (value === null) return;
    patch(user.id, { [field]: value }, `${label} updated.`);
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
          <input id="uid" autoCapitalize="none" value={userId} onChange={(e) => setUserId(e.target.value)} className={inputClass} placeholder="e.g. safna" />
        </div>
        <div>
          <label htmlFor="pw" className={labelClass}>Password *</label>
          <input id="pw" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="8+ chars, letters & numbers" />
        </div>
        <div>
          <label htmlFor="role" className={labelClass}>Role *</label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputClass}>
            {assignableRoles.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-black/50">{ROLE_HELP[role]}</p>
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
                  return (
                    <tr key={u.id} className={u.is_active ? "" : "opacity-50"}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">
                          {u.full_name}
                          {self && <span className="ml-2 text-xs text-black/40">(you)</span>}
                        </p>
                        <p className="font-mono text-xs text-black/50">{u.user_id}</p>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={u.role}
                          disabled={self || locked}
                          onChange={(e) => patch(u.id, { role: e.target.value }, "Role updated. It applies from their next login.")}
                          className="rounded-xl border border-black/10 px-2 py-1 disabled:opacity-60"
                          aria-label={`Role for ${u.user_id}`}
                        >
                          {(isSuper ? ASSIGNABLE_ROLES : ASSIGNABLE_ROLES.filter((r) => !PROTECTED.includes(r)))
                            .concat([u.role])
                            .filter((r, i, all) => all.indexOf(r) === i)
                            .map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {u.role === "director" ? (
                          <DirectorStores
                            current={u.director_stores ?? []}
                            stores={stores.filter((s) => s.name !== "CORPORATE OFFICE").map((s) => s.name)}
                            disabled={locked}
                            onSave={(list) => patch(u.id, { directorStores: list }, "Director's stores updated.")}
                          />
                        ) : (
                        <select
                          value={u.store_name ?? ""}
                          disabled={locked}
                          onChange={(e) => patch(u.id, { storeName: e.target.value }, "Store updated.")}
                          className="max-w-[220px] rounded-xl border border-black/10 px-2 py-1 disabled:opacity-60"
                          aria-label={`Store for ${u.user_id}`}
                        >
                          <option value="">— No store —</option>
                          {u.store_name && !stores.some((s) => s.name === u.store_name) && (
                            <option value={u.store_name}>{u.store_name} (not in Zoho — please change)</option>
                          )}
                          {stores.map((s) => (
                            <option key={s.name} value={s.name}>{storeLabel(s)}</option>
                          ))}
                        </select>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="flex flex-col gap-1">
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={u.notify_email}
                              disabled={locked}
                              onChange={(e) => patch(u.id, { notifyEmail: e.target.checked }, "Alert setting saved.")}
                              aria-label="E-mail alerts on"
                            />
                            <button type="button" disabled={locked} onClick={() => ask(u, "E-mail", u.email, "email")} className="hover:underline">
                              {u.email || <span className="text-black/40">Add e-mail</span>}
                            </button>
                          </span>
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={u.notify_whatsapp}
                              disabled={locked}
                              onChange={(e) => patch(u.id, { notifyWhatsapp: e.target.checked }, "Alert setting saved.")}
                              aria-label="WhatsApp alerts on"
                            />
                            <button type="button" disabled={locked} onClick={() => ask(u, "WhatsApp number", u.whatsapp_number, "whatsappNumber")} className="hover:underline">
                              {u.whatsapp_number ? `WA ${u.whatsapp_number}` : <span className="text-black/40">Add WhatsApp</span>}
                            </button>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-black/55">
                        {u.last_login_at ? formatDateTime(u.last_login_at) : "Never"}
                      </td>
                      <td className="px-4 py-3">
                        {!locked && (
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => resetPassword(u)} className="rounded-xl border border-black/10 px-3 py-1 text-xs font-bold hover:bg-[#f7f9fb]">
                              Reset password
                            </button>
                            {!self && (
                              <button
                                type="button"
                                onClick={() =>
                                  patch(u.id, { isActive: !u.is_active }, u.is_active ? `${u.user_id} disabled.` : `${u.user_id} enabled.`)
                                }
                                className={`rounded-xl px-3 py-1 text-xs font-bold ${u.is_active ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}
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

function DirectorStores({
  current,
  stores,
  disabled,
  onSave,
}: {
  current: string[];
  stores: string[];
  disabled: boolean;
  onSave: (list: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<string[]>(current);
  return (
    <div className="max-w-[240px] text-xs">
      <p className="font-bold">CORPORATE OFFICE</p>
      <p className="text-black/60">Looks after: {current.length ? current.join(", ") : "all stores"}</p>
      {!disabled && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-[#11b8d0] hover:underline">
          {open ? "Close" : "Change stores"}
        </button>
      )}
      {open && (
        <div className="mt-2 space-y-1 rounded-xl border border-black/10 p-2">
          {stores.map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={list.includes(s)}
                onChange={(e) => setList((l) => (e.target.checked ? [...l, s] : l.filter((x) => x !== s)))}
              />
              {s}
            </label>
          ))}
          <button
            type="button"
            onClick={() => {
              onSave(list);
              setOpen(false);
            }}
            className="mt-1 rounded-lg bg-[#161616] px-3 py-1 font-bold text-white"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
