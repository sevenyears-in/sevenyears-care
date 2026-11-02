"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ErrorBox, inputClass, labelClass } from "@/components/SiteChrome";

type View = {
  waEnabled: boolean;
  waVerifyToken: string;
  waAppSecretSaved: boolean;
  waWebhookUrl: string;
  whatsappReady: boolean;
  airaEnabled: boolean;
  airaApiKey: string;
  airaBaseUrl: string;
};

const section = "rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5";

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <code className="block flex-1 break-all rounded-2xl bg-[#f7f9fb] p-3 text-xs">{value || "—"}</code>
      {value && (
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => null);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
          className="rounded-xl border border-black/10 px-3 py-2 text-xs font-bold hover:bg-[#f7f9fb]"
        >
          {done ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

function Toggle({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`rounded-full px-4 py-2 text-sm font-bold disabled:opacity-50 ${on ? "bg-green-600 text-white" : "bg-black/10 text-black/60"}`}
      aria-pressed={on}
    >
      {on ? `${label}: ON` : `${label}: OFF`}
    </button>
  );
}

export default function ChannelsPage() {
  const [view, setView] = useState<View | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/staff/admin/channels").catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    if (response?.ok) setView(data as View);
    else setError(data.error ?? "Unable to load.");
  }, []);

  useEffect(() => {
    const run = async () => {
      await load();
    };
    run();
  }, [load]);

  const save = async (change: Record<string, unknown>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/staff/admin/channels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) {
      setError(data.error ?? "Unable to save.");
      return;
    }
    setView(data.settings as View);
    setSecret("");
    setNotice(success);
  };

  if (!view) {
    return <div className={section}>{error ? <ErrorBox message={error} /> : <p className="text-sm text-black/55">Loading...</p>}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Complaint Channels</h1>
        <p className="mt-2 text-sm text-black/60">
          Let customers register complaints by WhatsApp and through the Seven Years chatbot Aira. Complaints from these
          channels go to the same Complaints list as the website, marked with where they came from. Only the Super Admin
          can see this page.
        </p>
      </div>

      <ErrorBox message={error} />
      {notice && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">{notice}</div>
      )}

      {/* WhatsApp */}
      <div className={section}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-lg font-bold">1. WhatsApp complaints</p>
          <Toggle
            on={view.waEnabled}
            label="WhatsApp"
            disabled={busy}
            onChange={(v) => save({ waEnabled: v }, v ? "WhatsApp complaints turned on." : "WhatsApp complaints turned off.")}
          />
        </div>
        <p className="mt-2 text-sm text-black/60">
          Customers send any message (for example “Hi”) to the Seven Years Care WhatsApp number. The bot asks their name,
          bill or warranty number, what the complaint is about and the details, then registers it and replies with the complaint number.
          They can also check the status of their requests.
        </p>
        {!view.whatsappReady && (
          <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
            First add the WhatsApp token and Phone number ID in{" "}
            <Link href="/staff/admin/notifications" className="font-bold underline">Alerts Setup</Link> — the bot uses them
            to reply.
          </p>
        )}

        <p className="mt-5 text-sm font-bold">Connect it in Meta (one time)</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-black/60">
          <li>developers.facebook.com → your app → WhatsApp → <b>Configuration</b> → Webhook → <b>Edit</b>.</li>
          <li>Paste the <b>Callback URL</b> and <b>Verify token</b> below → <b>Verify and save</b>.</li>
          <li>Under Webhook fields, <b>Subscribe</b> to <b>messages</b>.</li>
          <li>Copy the <b>App secret</b> (App settings → Basic → Show) into the box below and save.</li>
        </ol>

        <div className="mt-4 space-y-3">
          <div>
            <p className={labelClass}>Callback URL</p>
            <Copy value={view.waWebhookUrl} />
          </div>
          <div>
            <p className={labelClass}>Verify token</p>
            {view.waVerifyToken ? (
              <Copy value={view.waVerifyToken} />
            ) : (
              <button type="button" disabled={busy} onClick={() => save({ newVerifyToken: true }, "Verify token created.")} className="rounded-xl bg-[#161616] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                Create verify token
              </button>
            )}
          </div>
          <div>
            <label htmlFor="secret" className={labelClass}>App secret {view.waAppSecretSaved && <span className="text-green-700">(saved)</span>}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="secret"
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className={inputClass}
                placeholder={view.waAppSecretSaved ? "Saved — paste a new one to replace" : "Paste the App secret from Meta"}
              />
              <button
                type="button"
                disabled={busy || !secret.trim()}
                onClick={() => save({ waAppSecret: secret }, "App secret saved. Only messages signed by Meta are accepted now.")}
                className="rounded-2xl bg-[#161616] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                Save
              </button>
            </div>
            <p className="mt-1 text-xs text-black/50">Recommended: with it, the app ignores anything that doesn&apos;t come from Meta.</p>
          </div>
        </div>
      </div>

      {/* Aira */}
      <div className={section}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-lg font-bold">2. Aira chatbot</p>
          <Toggle
            on={view.airaEnabled}
            label="Aira"
            disabled={busy}
            onChange={(v) => save({ airaEnabled: v }, v ? "Aira channel turned on." : "Aira channel turned off.")}
          />
        </div>
        <p className="mt-2 text-sm text-black/60">
          Give these details to whoever manages Aira. Aira sends the customer&apos;s complaint here and gets the complaint
          number back to show the customer. It can also look up the status of their requests.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <p className={labelClass}>API key (send as the header X-API-Key)</p>
            {view.airaApiKey ? (
              <div className="space-y-2">
                <Copy value={view.airaApiKey} />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => window.confirm("Make a new key? Aira stops working until it is given the new key.") && save({ newAiraKey: true }, "New API key created — give it to the Aira team.")}
                  className="rounded-xl border border-black/10 px-3 py-2 text-xs font-bold hover:bg-[#f7f9fb] disabled:opacity-50"
                >
                  New key
                </button>
              </div>
            ) : (
              <p className="text-sm text-black/55">Turn Aira on to create the key.</p>
            )}
          </div>

          <div className="rounded-2xl bg-[#f7f9fb] p-4 text-xs leading-6">
            <p className="font-bold">Register a complaint</p>
            <p className="font-mono">POST {view.airaBaseUrl}/complaints</p>
            <p className="font-mono">
              {'{ "name": "Anu", "mobile": "9876543210", "reference": "VDK26-SI1-8504", "description": "…", "category": "Product quality" }'}
            </p>
            <p className="mt-2">reference (bill or warranty number) is required — it gives the store and the staff on the bill. category and email are optional. Reply: complaintNumber, staffName, storeName, status, trackUrl, message.</p>

            <p className="mt-3 font-bold">Store names and complaint categories (for Aira&apos;s menus)</p>
            <p className="font-mono">GET {view.airaBaseUrl}/options</p>

            <p className="mt-3 font-bold">Status of a customer&apos;s requests</p>
            <p className="font-mono">GET {view.airaBaseUrl}/status?mobile=9876543210</p>
          </div>
        </div>
      </div>
    </div>
  );
}
