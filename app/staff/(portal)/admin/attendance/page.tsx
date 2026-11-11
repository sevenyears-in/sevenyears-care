"use client";

import { useEffect, useState } from "react";
import { ErrorBox, inputClass, labelClass } from "@/components/SiteChrome";
import { formatDateTime } from "@/lib/helpers";

type Status = {
  hasKey: boolean;
  keyCreatedAt: string | null;
  lastSyncAt: string | null;
  lastSyncCount: number;
  punchesToday: number;
  peopleToday: number;
  unlinkedCodes: string[];
  linkedStaff: number;
  tableReady: boolean;
  scriptVersion: number;
  backfillFrom: string | null;
  backfillAskedAt: string | null;
  backfillDoneAt: string | null;
  backfillDoneFrom: string | null;
  backfillSent: number;
};

/** First day of last month (YYYY-MM-DD). */
function lastMonthStart() {
  const d = new Date();
  const m = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-01`;
}

const card = "rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5";
const ps = (v: string) => v.replace(/'/g, "''"); // safe inside a PowerShell '...' string

export default function AttendanceSetupPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [server, setServer] = useState("");
  const [database, setDatabase] = useState("etimetracklite1");
  const [useSql, setUseSql] = useState(false);
  const [sqlUser, setSqlUser] = useState("sa");
  const [sqlPassword, setSqlPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [olderFrom, setOlderFrom] = useState(lastMonthStart);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState("");

  const askOlder = async (action: "backfill" | "backfillCancel") => {
    setOlderBusy(true);
    setOlderError("");
    try {
      const r = await fetch("/api/staff/admin/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, from: olderFrom }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      await load();
    } catch (e) {
      setOlderError(e instanceof Error ? e.message : "Could not ask for the punches.");
    } finally {
      setOlderBusy(false);
    }
  };

  const load = () =>
    fetch("/api/staff/admin/attendance", { cache: "no-store" })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => null);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const download = async () => {
    setError("");
    if (!server.trim()) return setError("Enter the SQL Server name from eTimeTrackLite.");
    if (!database.trim()) return setError("Enter the database name.");
    if (useSql && !sqlUser.trim()) return setError("Enter the SQL login name.");
    if (status?.hasKey && !window.confirm("A new script stops the old one from working. Continue?")) return;
    setBusy(true);
    try {
      const [keyRes, tpl] = await Promise.all([
        fetch("/api/staff/admin/attendance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "newKey" }),
        }).then((r) => r.json()),
        fetch("/downloads/attendance-sync-template.ps1", { cache: "no-store" }).then((r) => r.text()),
      ]);
      if (!keyRes.key) throw new Error(keyRes.error || "Could not create the key.");
      const script = tpl
        .replace("__SERVER__", () => ps(server.trim()))
        .replace("__DATABASE__", () => ps(database.trim()))
        .replace("__SQLUSER__", () => useSql ? ps(sqlUser.trim()) : "")
        .replace("__SQLPASSWORD__", () => useSql ? ps(sqlPassword) : "")
        .replace("__URL__", () => `${window.location.origin}/api/attendance/push`)
        .replace("__KEY__", () => keyRes.key)
        .replace(/\n/g, "\r\n");
      const blob = new Blob([script], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "SevenYearsSync.ps1";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setDone(true);
      setSqlPassword("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const cmd = (flag: string) => `powershell -ExecutionPolicy Bypass -File C:\\SevenYearsSync\\SevenYearsSync.ps1 ${flag}`;
  const syncedRecently = status?.lastSyncAt && Date.now() - new Date(status.lastSyncAt).getTime() < 10 * 60_000;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Attendance (eTimeTrackLite)</h1>
        <p className="mt-2 max-w-3xl text-sm text-black/60">
          Shows who is in each store right now. A small script on the office PC reads new punches from eTimeTrackLite
          every 2 minutes and sends them here. eTimeTrackLite and the machines keep working exactly as before.
        </p>
      </div>

      {status && (
        <div className={`${card} grid gap-4 sm:grid-cols-4`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-black/45">Sync</p>
            <p className={`mt-1 text-lg font-bold ${syncedRecently ? "text-green-700" : "text-black/50"}`}>
              {!status.tableReady ? "Database not ready" : syncedRecently ? "● Working" : status.lastSyncAt ? "● Not syncing" : "Not set up"}
            </p>
            {status.lastSyncAt && <p className="text-xs text-black/45">Last: {formatDateTime(status.lastSyncAt)}</p>}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-black/45">Punches today</p>
            <p className="mt-1 text-2xl font-bold">{status.punchesToday}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-black/45">People punched today</p>
            <p className="mt-1 text-2xl font-bold">{status.peopleToday}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-black/45">Matched to staff today</p>
            <p className="mt-1 text-2xl font-bold">{status.linkedStaff}</p>
          </div>
          {status.unlinkedCodes.length > 0 && (
            <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-4">
              Employee codes punching today that don&apos;t match any staff User ID: <b>{status.unlinkedCodes.join(", ")}</b>. The
              User ID on <a href="/staff/admin/users" className="font-bold underline">Staff Users</a> must be the same as the
              eTimeTrackLite employee code.
            </p>
          )}
        </div>
      )}

      {status?.hasKey && (
        <div className={card}>
          <h2 className="text-lg font-bold">Pull older punches from eTimeTrackLite</h2>
          <p className="mt-1 max-w-3xl text-sm text-black/60">
            Days before the sync started show “No punching data” on the duties pages. Choose a day and the office PC sends every
            punch from that day onwards at its next run (within 2 minutes). Punches already here are not doubled.
          </p>
          {status.scriptVersion < 2 && (
            <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
              The script on the office PC is the older version and cannot send older punches. Download the new script below
              (steps 1–2), put it in <b className="font-mono">C:\SevenYearsSync</b> in place of the old one, and run the{" "}
              <b>-Check</b> command once (step 3). The scheduled sync keeps running — no need to install again.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className={labelClass}>From</span>
              <input type="date" value={olderFrom} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setOlderFrom(e.target.value)} className={inputClass} />
            </label>
            <button
              type="button"
              onClick={() => askOlder("backfill")}
              disabled={olderBusy || !olderFrom}
              className="rounded-2xl bg-[#161616] px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
            >
              {olderBusy ? "Asking…" : "↻ Pull punches from this day"}
            </button>
            {status.backfillFrom && (
              <button type="button" onClick={() => askOlder("backfillCancel")} disabled={olderBusy} className="rounded-2xl px-4 py-3 text-sm font-semibold ring-1 ring-black/10">
                Cancel
              </button>
            )}
          </div>
          <ErrorBox message={olderError} />
          {status.backfillFrom ? (
            <p className="mt-3 text-sm font-semibold text-amber-700">
              ⏳ Waiting for the office PC to send punches from {status.backfillFrom}
              {status.backfillAskedAt ? ` (asked ${formatDateTime(status.backfillAskedAt)})` : ""}. This page updates by itself.
            </p>
          ) : status.backfillDoneAt ? (
            <p className="mt-3 text-sm font-semibold text-green-700">
              ✓ {status.backfillSent} punch(es) from {status.backfillDoneFrom} received on {formatDateTime(status.backfillDoneAt)}.
            </p>
          ) : null}
        </div>
      )}

      <div className={card}>
        <h2 className="text-lg font-bold">1. Database details (from eTimeTrackLite)</h2>
        <p className="mt-1 text-sm text-black/55">
          Copy these from the eTimeTrackLite login screen or Database Settings on the office PC.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>SQL Server name *</span>
            <input value={server} onChange={(e) => setServer(e.target.value)} className={inputClass} placeholder="e.g. OFFICE-PC\SQLEXPRESS" />
          </label>
          <label className="block">
            <span className={labelClass}>Database name *</span>
            <input value={database} onChange={(e) => setDatabase(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={useSql} onChange={(e) => setUseSql(e.target.checked)} className="h-4 w-4" />
          eTimeTrackLite logs in to SQL Server with a user name and password (SQL Server Authentication)
        </label>
        {useSql && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>SQL login</span>
              <input value={sqlUser} onChange={(e) => setSqlUser(e.target.value)} className={inputClass} autoComplete="off" />
            </label>
            <label className="block">
              <span className={labelClass}>SQL password</span>
              <input type="password" value={sqlPassword} onChange={(e) => setSqlPassword(e.target.value)} className={inputClass} autoComplete="new-password" />
              <span className="mt-1 block text-xs text-black/45">Goes only into the downloaded file. It is not saved on the website.</span>
            </label>
          </div>
        )}
        <ErrorBox message={error} />
        <button type="button" onClick={download} disabled={busy} className="mt-4 rounded-2xl bg-[#161616] px-5 py-3 text-sm font-bold text-white disabled:opacity-40">
          {busy ? "Preparing…" : "2. Download sync script"}
        </button>
        {done && <p className="mt-2 text-sm font-semibold text-green-700">Downloaded SevenYearsSync.ps1 — now follow step 3.</p>}
      </div>

      <div className={card}>
        <h2 className="text-lg font-bold">3. Set it up on the office PC (once)</h2>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-black/75">
          <li>
            On the office PC, create the folder <b className="font-mono">C:\SevenYearsSync</b> and put the downloaded{" "}
            <b>SevenYearsSync.ps1</b> in it. (Keep this file on that PC only — it holds the private sync key.)
          </li>
          <li>
            Click Start, type <b>PowerShell</b>, right-click <b>Windows PowerShell</b> → <b>Run as administrator</b>.
          </li>
          <li>
            Paste this and press Enter — it checks the database and the website:
            <code className="mt-1 block break-all rounded-xl bg-[#161616] p-3 font-mono text-xs text-white">{cmd("-Check")}</code>
            It should end with <b>“Everything is working”</b>.
          </li>
          <li>
            Then paste this and press Enter — it runs the sync every 2 minutes:
            <code className="mt-1 block break-all rounded-xl bg-[#161616] p-3 font-mono text-xs text-white">{cmd("-Install")}</code>
          </li>
          <li>
            Nothing else to link: staff are matched by their <b>User ID</b>, which is the same as their eTimeTrackLite
            employee code.
          </li>
        </ol>
        <p className="mt-4 text-xs text-black/45">
          If something fails, the reason is written in C:\SevenYearsSync\sync.log. To stop syncing: {cmd("-Uninstall")}
        </p>
      </div>
    </div>
  );
}
