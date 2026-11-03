"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ErrorBox, inputClass, labelClass } from "@/components/SiteChrome";

type View = {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  mailFrom: string;
  smtpPassSaved: boolean;
  waPhoneNumberId: string;
  waStaffTemplate: string;
  waCustomerTemplate: string;
  waLanguage: string;
  waTokenSaved: boolean;
  cronUrl: string;
  emailReady: boolean;
  whatsappReady: boolean;
  cronReady: boolean;
};

const sectionClass = "rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5";

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${ok ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
      {ok ? "✅ " : "⚠️ "}
      {label}
    </span>
  );
}

export function AlertSettingsForm() {
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState({
    smtpHost: "",
    smtpPort: "465",
    smtpUser: "",
    mailFrom: "",
    smtpPass: "",
    waPhoneNumberId: "",
    waStaffTemplate: "",
    waCustomerTemplate: "",
    waLanguage: "",
    waToken: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const apply = useCallback((v: View) => {
    setView(v);
    setForm({
      smtpHost: v.smtpHost,
      smtpPort: String(v.smtpPort || 465),
      smtpUser: v.smtpUser,
      mailFrom: v.mailFrom,
      smtpPass: "",
      waPhoneNumberId: v.waPhoneNumberId,
      waStaffTemplate: v.waStaffTemplate,
      waCustomerTemplate: v.waCustomerTemplate,
      waLanguage: v.waLanguage,
      waToken: "",
    });
  }, []);

  useEffect(() => {
    const run = async () => {
      const response = await fetch("/api/staff/admin/notifications").catch(() => null);
      const data = response ? await response.json().catch(() => ({})) : {};
      if (response?.ok) apply(data as View);
      else setError(data.error ?? "Unable to load the alert settings.");
    };
    run();
  }, [apply]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (extra: Record<string, unknown> = {}, success = "Settings saved.") => {
    setSaving(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/staff/admin/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, ...extra }),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setSaving(false);
    if (!response?.ok) {
      setError(data.error ?? "Unable to save.");
      return;
    }
    apply(data.settings as View);
    setNotice(success);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save();
  };

  const copyCron = async () => {
    if (!view?.cronUrl) return;
    await navigator.clipboard.writeText(view.cronUrl).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!view) {
    return (
      <div className={sectionClass}>
        {error ? <ErrorBox message={error} /> : <p className="text-sm text-black/55">Loading settings...</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" autoComplete="off">
      {/* E-mail */}
      <div className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-lg font-bold">1. E-mail alerts</p>
          <Status ok={view.emailReady} label={view.emailReady ? "Ready" : "Not set up"} />
        </div>
        <p className="mt-1 text-sm text-black/55">
          Use a mailbox such as care@sevenyears.in (Hostinger: hPanel → Emails). For Hostinger mail use server
          smtp.hostinger.com and port 465.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="smtpHost" className={labelClass}>Mail server (SMTP)</label>
            <input id="smtpHost" value={form.smtpHost} onChange={set("smtpHost")} className={inputClass} placeholder="smtp.hostinger.com" />
          </div>
          <div>
            <label htmlFor="smtpPort" className={labelClass}>Port</label>
            <select id="smtpPort" value={form.smtpPort} onChange={set("smtpPort")} className={inputClass}>
              <option value="465">465 (SSL — recommended)</option>
              <option value="587">587 (STARTTLS)</option>
            </select>
          </div>
          <div>
            <label htmlFor="smtpUser" className={labelClass}>Mailbox login (e-mail)</label>
            <input id="smtpUser" value={form.smtpUser} onChange={set("smtpUser")} className={inputClass} placeholder="care@sevenyears.in" />
          </div>
          <div>
            <label htmlFor="smtpPass" className={labelClass}>Mailbox password</label>
            <input
              id="smtpPass"
              type="password"
              autoComplete="new-password"
              value={form.smtpPass}
              onChange={set("smtpPass")}
              className={inputClass}
              placeholder={view.smtpPassSaved ? "Saved — leave blank to keep" : "Enter the mailbox password"}
            />
          </div>
          <div>
            <label htmlFor="mailFrom" className={labelClass}>Send from</label>
            <input id="mailFrom" value={form.mailFrom} onChange={set("mailFrom")} className={inputClass} placeholder="care@sevenyears.in" />
          </div>
        </div>
      </div>

      {/* WhatsApp */}
      <div className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-lg font-bold">2. WhatsApp alerts</p>
          <Status ok={view.whatsappReady} label={view.whatsappReady ? "Ready" : "Not set up"} />
        </div>
        <p className="mt-1 text-sm text-black/55">
          From Meta WhatsApp Cloud API (developers.facebook.com → your app → WhatsApp → API Setup). Both message
          templates must be approved by Meta first — see NOTIFICATIONS-SETUP.md for the template wording.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="waToken" className={labelClass}>Permanent access token</label>
            <input
              id="waToken"
              type="password"
              autoComplete="new-password"
              value={form.waToken}
              onChange={set("waToken")}
              className={inputClass}
              placeholder={view.waTokenSaved ? "Saved — leave blank to keep" : "Paste the token from Meta"}
            />
          </div>
          <div>
            <label htmlFor="waPhone" className={labelClass}>Phone number ID</label>
            <input id="waPhone" inputMode="numeric" value={form.waPhoneNumberId} onChange={set("waPhoneNumberId")} className={inputClass} placeholder="e.g. 123456789012345" />
          </div>
          <div>
            <label htmlFor="waStaff" className={labelClass}>Staff alert template</label>
            <input id="waStaff" value={form.waStaffTemplate} onChange={set("waStaffTemplate")} className={inputClass} placeholder="staff_ticket_alert" />
          </div>
          <div>
            <label htmlFor="waCust" className={labelClass}>Customer update template</label>
            <input id="waCust" value={form.waCustomerTemplate} onChange={set("waCustomerTemplate")} className={inputClass} placeholder="customer_ticket_update" />
          </div>
          <div>
            <label htmlFor="waLang" className={labelClass}>Template language</label>
            <input id="waLang" value={form.waLanguage} onChange={set("waLanguage")} className={inputClass} placeholder="en" />
          </div>
        </div>
      </div>

      {/* Escalation */}
      <div className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-lg font-bold">3. Automatic escalation</p>
          <Status ok={view.cronReady} label={view.cronReady ? "Key ready" : "Not set up"} />
        </div>
        <p className="mt-1 text-sm text-black/55">
          Late requests are escalated when this address is opened every 30 minutes. In Hostinger: hPanel → Advanced →
          Cron Jobs → every 30 minutes → command <span className="font-mono">curl -s &quot;address&quot;</span>. Keep
          this address private.
        </p>
        {view.cronUrl ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="block flex-1 break-all rounded-2xl bg-[#f7f9fb] p-3 text-xs">{view.cronUrl}</code>
            <div className="flex gap-2">
              <button type="button" onClick={copyCron} className="rounded-xl border border-black/10 px-3 py-2 text-xs font-bold hover:bg-[#f7f9fb]">
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  if (window.confirm("Make a new key? The old cron address will stop working until you update the cron job.")) {
                    save({ newCronKey: true }, "New escalation address created — update the cron job with it.");
                  }
                }}
                className="rounded-xl border border-black/10 px-3 py-2 text-xs font-bold hover:bg-[#f7f9fb] disabled:opacity-50"
              >
                New key
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm font-semibold text-black/60">Press “Save settings” and the address will be created.</p>
        )}
      </div>

      <ErrorBox message={error} />
      {notice && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">{notice}</div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className="rounded-2xl bg-[#ff5e79] px-6 py-3 font-bold text-white disabled:opacity-50">
          {saving ? "Saving..." : "Save settings"}
        </button>
        {view.smtpPassSaved && (
          <button
            type="button"
            disabled={saving}
            onClick={() => window.confirm("Remove the saved mailbox password?") && save({ clearSmtpPass: true }, "Mailbox password removed.")}
            className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-bold disabled:opacity-50"
          >
            Remove mailbox password
          </button>
        )}
        {view.waTokenSaved && (
          <button
            type="button"
            disabled={saving}
            onClick={() => window.confirm("Remove the saved WhatsApp token?") && save({ clearWaToken: true }, "WhatsApp token removed.")}
            className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-bold disabled:opacity-50"
          >
            Remove WhatsApp token
          </button>
        )}
      </div>
    </form>
  );
}
