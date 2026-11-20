"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ErrorBox, inputClass, labelClass } from "@/components/SiteChrome";
import { formatDateTime } from "@/lib/helpers";
import { ZohoStoresCard } from "@/components/ZohoStoresCard";
import { PasswordInput } from "@/components/PasswordInput";

type Status = {
  usingEnvFile: boolean;
  clientIdMasked: string;
  hasClientSecret: boolean;
  connected: boolean;
  organizationId: string | null;
  organizationName: string | null;
  organizations: { id: string; name: string }[];
  previousOrganizations?: { id: string; name: string; until: string | null }[];
  skipBillPrefixes?: string[];
  connectedAt: string | null;
  redirectUri: string;
  homepageUrl: string;
};

const errorText: Record<string, string> = {
  "keys-missing": "Save the Client ID and Client Secret first.",
  "state-mismatch": "The connection took too long or was started twice. Please click Connect again.",
  access_denied: "Zoho access was not approved. Click Connect and choose Accept.",
  invalid_client: "Zoho didn't recognise the Client ID / Secret. Check they were copied fully.",
  invalid_code: "The Zoho code expired. Please click Connect again.",
  "save-failed": "Connected to Zoho but couldn't save. Has the app_settings table been created?",
};

export default function ZohoConnectionPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [manualOrg, setManualOrg] = useState("");
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/staff/admin/zoho");
    const data = await response.json().catch(() => ({}));
    if (response.ok) setStatus(data);
    else setErrorMessage(data.error || "Unable to load the Zoho settings.");
  }, []);

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const err = params.get("error");
      if (err) setErrorMessage(errorText[err] ?? `Zoho returned: ${err}`);
      if (params.get("connected")) setMessage("Zoho POS is connected.");
      if (params.get("choose-org")) setMessage("Connected. Please choose your organisation below.");
      if (params.get("org-missing"))
        setMessage("Connected, but Zoho didn't list your organisation. Enter the Organisation ID below.");
      if (params.toString()) window.history.replaceState(null, "", "/staff/admin/zoho");
      await load();
    };
    run();
  }, [load]);

  const saveKeys = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setMessage("");
    setSaving(true);
    const response = await fetch("/api/staff/admin/zoho", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setErrorMessage(data.error || "Unable to save the keys.");
      return;
    }
    setClientId("");
    setClientSecret("");
    setMessage("Keys saved. Now click Connect to Zoho.");
    load();
  };

  const chooseOrg = async (organizationId: string) => {
    setErrorMessage("");
    const response = await fetch("/api/staff/admin/zoho", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setErrorMessage(data.error || "Unable to save the organisation.");
    else setMessage("Organisation saved. Zoho POS is ready.");
    load();
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Zoho POS? Bill fetching will go back to demo mode.")) return;
    await fetch("/api/staff/admin/zoho", { method: "DELETE" });
    setMessage("Disconnected.");
    load();
  };

  const testConnection = async () => {
    setTestResult("Testing...");
    const response = await fetch("/api/staff/bill-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billNumber: "CONNECTION-TEST-0000", billDate: "2026-01-01" }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 404) {
      setTestResult("✓ Zoho POS answered correctly (the test bill doesn't exist, as expected).");
    } else if (response.ok && data.bill?.demo) {
      setTestResult("Still in demo mode — the connection isn't complete yet.");
    } else {
      setTestResult(`Zoho POS returned: ${data.error ?? response.status}`);
    }
  };

  const ready = Boolean(status?.connected && status.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Zoho POS Connection</h1>
        <p className="mt-2 max-w-2xl text-sm text-black/60">
          Connect once so staff can fetch bills by bill number and date. The app only
          <b> reads</b> bills, items and customers — it never changes anything in Zoho POS.
        </p>
      </div>

      {message && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">
          {message}
        </div>
      )}
      <ErrorBox message={errorMessage} />

      {status?.usingEnvFile && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Zoho keys are set in <code>.env.local</code>, which takes priority over this page.
        </div>
      )}

      {/* Status */}
      <div
        className={`rounded-3xl p-5 ${ready ? "bg-green-600 text-white" : "bg-white soft-card ring-1 ring-black/5"}`}
      >
        <p className="text-xs font-bold uppercase tracking-wider opacity-70">Status</p>
        <p className="mt-1 text-xl font-bold">
          {ready ? "Connected" : status?.connected ? "Almost done — choose organisation" : "Not connected (demo mode)"}
        </p>
        {ready && (
          <p className="mt-1 text-sm opacity-90">
            Organisation {status?.organizationName ? `${status.organizationName} ` : ""}({status?.organizationId})
            {status?.connectedAt ? ` • connected ${formatDateTime(status.connectedAt)}` : ""}
          </p>
        )}
        {ready && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={testConnection} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-green-700">
              Test connection
            </button>
            <button type="button" onClick={disconnect} className="rounded-xl border border-white/50 px-4 py-2 text-sm font-bold">
              Disconnect
            </button>
          </div>
        )}
        {testResult && <p className="mt-3 text-sm font-semibold">{testResult}</p>}
      </div>

      {/* Step 1 */}
      <section className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-[#ff5e79]">Step 1</p>
        <h2 className="mt-1 text-lg font-bold">Paste the Zoho keys</h2>
        <p className="mt-1 text-sm text-black/60">
          In the Zoho API Console (api-console.zoho.in), open the <b>Seven Years Care</b> client →
          copy the <b>Client ID</b> and <b>Client Secret</b> with the copy icons, and paste them here.
        </p>
        {status?.clientIdMasked && (
          <p className="mt-3 text-sm">
            Saved Client ID: <span className="font-mono">{status.clientIdMasked}</span>
            {status.hasClientSecret ? " • secret saved" : ""}
          </p>
        )}
        <form onSubmit={saveKeys} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="cid" className={labelClass}>Client ID</label>
            <input id="cid" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} className={inputClass} placeholder="1000.XXXXXXXX" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="csec" className={labelClass}>Client Secret</label>
            <PasswordInput id="csec" value={clientSecret} onChange={(e) => setClientSecret(e.target.value.trim())} className={inputClass} autoComplete="off" />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={saving || !clientId || !clientSecret} className="rounded-2xl bg-[#161616] px-6 py-3 font-bold text-white disabled:opacity-40">
              {saving ? "Saving..." : "Save Keys"}
            </button>
          </div>
        </form>
        <details className="mt-4 text-xs text-black/50">
          <summary className="cursor-pointer font-semibold">Client settings in Zoho (for reference)</summary>
          <p className="mt-2">Client type: Server-based Application</p>
          <p>Homepage URL: <span className="font-mono">{status?.homepageUrl}</span></p>
          <p>Authorized Redirect URI: <span className="font-mono">{status?.redirectUri}</span></p>
        </details>
      </section>

      {/* Step 2 */}
      <section className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-[#ff5e79]">Step 2</p>
        <h2 className="mt-1 text-lg font-bold">Connect to Zoho</h2>
        <p className="mt-1 text-sm text-black/60">
          Zoho will ask you to approve read access. Choose <b>Accept</b> — you&apos;ll come back here automatically.
        </p>
        <a
          href="/api/staff/zoho/connect"
          aria-disabled={!status?.hasClientSecret}
          className={`mt-4 inline-block rounded-2xl px-6 py-3 font-bold text-white ${
            status?.hasClientSecret ? "bg-[#ff5e79]" : "pointer-events-none bg-[#ff5e79]/40"
          }`}
        >
          {status?.connected ? "Reconnect to Zoho" : "Connect to Zoho"}
        </a>
      </section>

      {/* Organisation choice */}
      {status?.connected && !status.organizationId && (
        <section className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-wider text-[#ff5e79]">Step 3</p>
          <h2 className="mt-1 text-lg font-bold">Choose the organisation</h2>
          {status.organizations.length > 0 ? (
            <div className="mt-3 space-y-2">
              {status.organizations.map((org) => (
                <button key={org.id} type="button" onClick={() => chooseOrg(org.id)} className="block w-full rounded-2xl border border-black/10 p-4 text-left hover:bg-[#f7f9fb]">
                  <span className="font-bold">{org.name}</span>
                  <span className="ml-2 font-mono text-xs text-black/50">{org.id}</span>
                </button>
              ))}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                chooseOrg(manualOrg.trim());
              }}
              className="mt-3 flex gap-3"
            >
              <input value={manualOrg} onChange={(e) => setManualOrg(e.target.value)} className={inputClass} placeholder="Organisation ID (Zoho POS → Settings → Organisation Profile)" />
              <button type="submit" className="rounded-2xl bg-[#161616] px-5 font-bold text-white">Save</button>
            </form>
          )}
        </section>
      )}

      {ready && status && <OrganisationsCard status={status} onSaved={load} />}

      {ready && <ZohoStoresCard />}
    </div>
  );
}

type Probe = { bills: number; more: boolean; first: string | null; last: string | null; stores: Record<string, number>; numberPrefixes: string[] } | { error: string };

/**
 * Which Zoho POS organisation is used now, and earlier ones (e.g. before the business moved to a
 * new company). Earlier organisations are still read for their bills: warranty look-ups,
 * history, and sales up to their last billing day.
 */
function OrganisationsCard({ status, onSaved }: { status: Status; onSaved: () => void }) {
  const previous = status.previousOrganizations ?? [];
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState("");
  const [rows, setRows] = useState<{ id: string; until: string }[]>([]);
  const [skip, setSkip] = useState("");
  const skipped = status.skipBillPrefixes ?? [];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [checkFrom, setCheckFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [check, setCheck] = useState<{ id: string; name: string; current: boolean; bills: Probe }[] | null>(null);
  const [checking, setChecking] = useState(false);

  const names = new Map<string, string>();
  for (const o of status.organizations) names.set(o.id, o.name);
  for (const o of previous) if (o.name) names.set(o.id, o.name);
  if (status.organizationId && status.organizationName) names.set(status.organizationId, status.organizationName);
  const label = (id: string) => (names.get(id) ? `${names.get(id)} (${id})` : id);
  const choices = [...new Set([...(status.organizationId ? [status.organizationId] : []), ...status.organizations.map((o) => o.id), ...previous.map((o) => o.id)])];

  const startEdit = () => {
    setCurrent(status.organizationId ?? "");
    setRows(previous.map((o) => ({ id: o.id, until: o.until ?? "" })));
    setSkip(skipped.join(", "));
    setError("");
    setEditing(true);
  };

  // Choosing a new current organisation keeps the old one as an earlier one.
  const pickCurrent = (id: string) => {
    const old = current;
    setCurrent(id);
    setRows((r) => {
      let next = r.filter((x) => x.id !== id);
      if (old && old !== id && !next.some((x) => x.id === old)) next = [...next, { id: old, until: "" }];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError("");
    const response = await fetch("/api/staff/admin/zoho", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: current,
        previousOrganizations: rows.filter((r) => r.id.trim()),
        skipBillPrefixes: skip.split(/[,\n]/).map((p) => p.trim()).filter(Boolean),
      }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(data.error || "Unable to save.");
      return;
    }
    setEditing(false);
    onSaved();
  };

  const runCheck = async () => {
    setChecking(true);
    setError("");
    const response = await fetch(`/api/staff/admin/zoho?check=1&from=${checkFrom}`);
    const data = await response.json().catch(() => ({}));
    setChecking(false);
    if (!response.ok) setError(data.error || "Could not reach Zoho POS.");
    else setCheck(data.organizations ?? []);
  };

  return (
    <section className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Organisations</h2>
          <p className="mt-1 max-w-2xl text-sm text-black/60">
            New bills come from the <b>current</b> organisation. Earlier organisations are still read for their bills
            (warranty, customer history, and sales up to their last billing day).
          </p>
        </div>
        {!editing && (
          <button type="button" onClick={startEdit} className="rounded-xl border border-black/15 px-4 py-2 text-sm font-bold">
            ✎ Edit
          </button>
        )}
      </div>

      {!editing ? (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            <span className="inline-block w-36 text-black/50">Current</span>
            <b>{status.organizationId ? label(status.organizationId) : "—"}</b>
          </p>
          {previous.length === 0 ? (
            <p>
              <span className="inline-block w-36 text-black/50">Earlier</span>none
            </p>
          ) : (
            previous.map((o) => (
              <p key={o.id}>
                <span className="inline-block w-36 text-black/50">Earlier</span>
                <b>{label(o.id)}</b>
                <span className="text-black/60"> — {o.until ? `last billing day ${o.until}` : "still billing (read every day)"}</span>
              </p>
            ))
          )}
          <p>
            <span className="inline-block w-36 text-black/50">Not counted</span>
            {skipped.length ? (
              <>
                bills starting with <b>{skipped.join(", ")}</b>
              </>
            ) : (
              "none"
            )}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <label className={labelClass}>Current organisation</label>
            <div className="flex flex-wrap gap-2">
              {choices.map((id) => (
                <button key={id} type="button" onClick={() => pickCurrent(id)} className={`rounded-xl border px-3 py-2 text-sm ${current === id ? "border-[#161616] bg-[#161616] font-bold text-white" : "border-black/15"}`}>
                  {label(id)}
                </button>
              ))}
            </div>
            <input value={current} onChange={(e) => pickCurrent(e.target.value.replace(/\D/g, ""))} className={`${inputClass} mt-2 max-w-xs`} placeholder="Or type the Organisation ID" />
          </div>
          <div>
            <label className={labelClass}>Earlier organisations</label>
            {rows.length === 0 && <p className="text-sm text-black/50">None.</p>}
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input value={r.id} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, id: e.target.value.replace(/\D/g, "") } : y)))} className={`${inputClass} max-w-[14rem]`} placeholder="Organisation ID" />
                  <span className="text-sm text-black/60">{names.get(r.id) ?? ""}</span>
                  <label className="text-sm text-black/60">Last billing day</label>
                  <input type="date" value={r.until} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, until: e.target.value } : y)))} className={`${inputClass} max-w-[11rem]`} />
                  <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="text-sm font-bold text-red-600">
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setRows((x) => [...x, { id: "", until: "" }])} className="mt-2 text-sm font-bold text-[#ff5e79]">
              + Add earlier organisation
            </button>
            <p className="mt-1 text-xs text-black/50">Leave the last billing day empty while that organisation still makes bills.</p>
          </div>
          <div>
            <label className={labelClass}>Bills not counted as sales (number starts with)</label>
            <input value={skip} onChange={(e) => setSkip(e.target.value)} className={`${inputClass} max-w-md`} placeholder="e.g. 26-INV-" />
            <p className="mt-1 text-xs text-black/50">For transfer or B2B invoices. Separate several with commas.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving || !current} className="rounded-xl bg-[#161616] px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-xl border border-black/15 px-5 py-2 text-sm font-bold">
              Cancel
            </button>
          </div>
        </div>
      )}

      <ErrorBox message={error} />

      <div className="mt-5 border-t border-black/5 pt-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Check bills in every organisation from</span>
          <input type="date" value={checkFrom} onChange={(e) => setCheckFrom(e.target.value)} className={`${inputClass} max-w-[11rem]`} />
          <button type="button" onClick={runCheck} disabled={checking} className="rounded-xl border border-black/15 px-4 py-2 font-bold disabled:opacity-40">
            {checking ? "Checking..." : "Check"}
          </button>
        </div>
        {check && (
          <div className="mt-3 space-y-2 text-sm">
            {check.length === 0 && <p className="text-black/60">This Zoho login opens no organisations.</p>}
            {check.map((o) => (
              <div key={o.id} className="rounded-2xl bg-[#f7f9fb] p-3">
                <p className="font-bold">
                  {o.name} <span className="font-mono text-xs text-black/50">{o.id}</span>
                  {o.current ? <span className="ml-2 rounded-full bg-green-600 px-2 py-0.5 text-xs text-white">current</span> : null}
                </p>
                {"error" in o.bills ? (
                  <p className="text-red-700">{o.bills.error}</p>
                ) : o.bills.bills === 0 ? (
                  <p className="text-black/60">No bills from {checkFrom}.</p>
                ) : (
                  <p className="text-black/70">
                    {o.bills.bills}
                    {o.bills.more ? "+" : ""} bills, {o.bills.first} to {o.bills.last} •{" "}
                    {Object.entries(o.bills.stores)
                      .map(([s, n]) => `${s}: ${n}`)
                      .join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
