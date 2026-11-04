"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBox, inputClass, labelClass } from "@/components/SiteChrome";
import { formatDateTime, todayISO } from "@/lib/helpers";
import type { ImportState } from "@/lib/zoho-import";

const card = "rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function daysAgo(n: number) {
  return todayISO(new Date(Date.now() - n * 86400_000));
}

export default function ZohoImportPage() {
  const [state, setState] = useState<ImportState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [from, setFrom] = useState(daysAgo(180));
  const [to, setTo] = useState(todayISO());
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const stopRef = useRef(false);

  useEffect(() => {
    fetch("/api/staff/admin/zoho-import", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setState(d.state ?? null))
      .finally(() => setLoaded(true));
  }, []);

  const loop = useCallback(async () => {
    setRunning(true);
    setError("");
    stopRef.current = false;
    let failures = 0;
    while (!stopRef.current) {
      const res = await fetch("/api/staff/admin/zoho-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "next" }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      if (data.state) setState(data.state);
      if (data.state?.done) break;

      if (!res || !res.ok || data.pause) {
        failures++;
        if (failures > 6) {
          setError(data.error || data.pause || "Zoho is not answering. Click Continue to try again later.");
          break;
        }
        setNote(`Zoho asked us to slow down — waiting a minute (${data.pause || data.error || "no answer"})…`);
        await wait(60_000);
        continue;
      }
      failures = 0;
      setNote("");
      await wait(1500); // stay well inside Zoho's request limit
    }
    setNote("");
    setRunning(false);
  }, []);

  const start = async () => {
    setError("");
    const res = await fetch("/api/staff/admin/zoho-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", from, to }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "Could not start.");
    setState(data.state);
    loop();
  };

  const stats = state
    ? [
        { label: "Bills checked", value: state.bills },
        { label: "Bills with warranty items", value: state.billsWithItems },
        { label: "Warranties added", value: state.created, strong: true },
        { label: "Already registered", value: state.alreadyThere },
        { label: "Skipped — no mobile in Zoho", value: state.noMobile },
        { label: "Skipped — void / draft", value: state.skippedStatus },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Import Warranties from Zoho</h1>
        <p className="mt-2 max-w-3xl text-sm text-black/60">
          Reads every Zoho POS bill in the dates below and adds a warranty for each item in an active warranty category
          (one per unit). Items already registered are left as they are. Customers are <b>not</b> sent any message; a
          customer login is created where none exists (password = last 4 digits of the bill number). Zoho has no serial
          numbers, so these warranties show <b>“Not recorded”</b> for the serial number — staff can fill it in from the
          warranty page.
        </p>
      </div>

      <ErrorBox message={error} />

      <div className={card}>
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label>
            <span className={labelClass}>Bills from</span>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputClass} disabled={running} />
          </label>
          <label>
            <span className={labelClass}>Bills up to</span>
            <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} className={inputClass} disabled={running} />
          </label>
          <button
            type="button"
            onClick={start}
            disabled={running || !loaded}
            className="rounded-2xl bg-[#161616] px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
          >
            {state && !state.done ? "Start again" : "Start import"}
          </button>
        </div>
        <p className="mt-3 text-xs text-black/45">Default: the last 180 days. Running it again is safe — nothing is added twice.</p>
      </div>

      {state && (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#ff5e79]">
                {state.done ? "Finished" : running ? "Importing…" : "Paused"}
              </p>
              <p className="mt-1 text-sm text-black/60">
                Bills {state.from} → {state.to} · started by {state.startedBy} · {formatDateTime(state.startedAt)}
              </p>
            </div>
            {!state.done &&
              (running ? (
                <button type="button" onClick={() => (stopRef.current = true)} className="rounded-2xl px-4 py-2 text-sm font-bold ring-1 ring-black/10">
                  Pause
                </button>
              ) : (
                <button type="button" onClick={loop} className="rounded-2xl bg-[#11b8d0] px-4 py-2 text-sm font-bold text-white">
                  Continue
                </button>
              ))}
          </div>

          {running && (
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/5">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-[#11b8d0]" />
            </div>
          )}
          {note && <p className="mt-3 text-xs text-amber-700">{note}</p>}
          {running && <p className="mt-2 text-xs text-black/45">Keep this page open while it runs. If you close it, come back and click Continue.</p>}

          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl bg-[#f7f9fb] p-4">
                <dt className="text-xs text-black/50">{s.label}</dt>
                <dd className={`mt-1 text-2xl font-bold ${s.strong ? "text-green-700" : ""}`}>{s.value}</dd>
              </div>
            ))}
          </dl>

          {state.failed.length > 0 && (
            <div className="mt-5">
              <p className="text-sm font-bold">Bills that could not be read ({state.failed.length})</p>
              <ul className="mt-2 space-y-1 text-xs text-black/60">
                {state.failed.map((f, i) => (
                  <li key={i}>
                    <span className="font-mono font-bold">{f.bill}</span> — {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.done && (
            <Link href="/staff/warranties" className="mt-5 inline-block text-sm font-bold text-[#0b7f90] hover:underline">
              See warranties →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
