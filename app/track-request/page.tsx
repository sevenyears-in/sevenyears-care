"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  cardClass,
  ErrorBox,
  inputClass,
  phoneInputClass,
  labelClass,
  PageShell,
  primaryButtonClass,
  StatusBadge,
} from "@/components/SiteChrome";
import { formatDate, formatDateTime } from "@/lib/helpers";
import { CUSTOMER_STATUS_LABELS } from "@/lib/sla";

function label(status: string) {
  return CUSTOMER_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

type Detail = { label: string; value: string | null; isDate?: boolean };
type HistoryItem = { status: string; note: string | null; createdAt: string };

type TrackResult = {
  type: "service" | "complaint";
  ticketNumber: string;
  title: string;
  description: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  details: Detail[];
  history: HistoryItem[];
};

const serviceSteps = ["open", "acknowledged", "assigned", "in_progress", "resolved", "closed"];
const complaintSteps = ["open", "acknowledged", "under_review", "in_progress", "resolved", "closed"];

export default function TrackRequestPage() {
  const [ticketNumber, setTicketNumber] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<TrackResult | null>(null);

  const lookup = useCallback(async (ticketValue: string, mobileValue: string) => {
    setErrorMessage("");
    setResult(null);

    const mobile = mobileValue.replace(/\D/g, "");
    const ticket = ticketValue.trim();

    if (!ticket) {
      setErrorMessage("Please enter your request or complaint number.");
      return;
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setErrorMessage("Please enter a valid 10-digit mobile number.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketNumber: ticket, mobileNumber: mobile }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error || "Unable to find this request.");
        return;
      }

      setResult(data);
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    lookup(ticketNumber, mobileNumber);
  };

  // Coming from the home page or a WhatsApp link: fill in and look up straight away.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("ticket")?.trim() ?? "";
    let saved: { ticket?: string; mobile?: string } = {};
    try {
      saved = JSON.parse(sessionStorage.getItem("sy_track") ?? "{}");
      sessionStorage.removeItem("sy_track");
    } catch {
      saved = {};
    }
    const ticket = fromUrl || saved.ticket || "";
    const mobile = saved.mobile ?? "";
    const run = async () => {
      if (ticket) setTicketNumber(ticket);
      if (mobile) setMobileNumber(mobile);
      if (ticket && mobile) await lookup(ticket, mobile);
    };
    run();
  }, [lookup]);

  return (
    <PageShell
      title="Track Request"
      intro="Check the latest status of a service request (SY-SRV-…) or complaint (SY-CMP-…)."
    >
      <div className={cardClass}>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div>
            <label htmlFor="ticket" className={labelClass}>
              Request / Complaint Number *
            </label>
            <input
              id="ticket"
              type="text"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
              className={inputClass}
              placeholder="SY-SRV-2026-123456"
            />
          </div>

          <div>
            <label htmlFor="mobile" className={labelClass}>
              Mobile Number *
            </label>
            <div className="flex">
              <div className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-4 text-sm font-semibold">
                +91
              </div>
              <input
                id="mobile"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                maxLength={10}
                className={phoneInputClass}
                placeholder="10-digit mobile number"
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <ErrorBox message={errorMessage} />
          </div>

          <div className="sm:col-span-2">
            <button type="submit" disabled={loading} className={primaryButtonClass}>
              {loading ? "Checking..." : "Check Status"}
            </button>
          </div>
        </form>
      </div>

      {result && <TrackResultCard result={result} />}
    </PageShell>
  );
}

function TrackResultCard({ result }: { result: TrackResult }) {
  const steps = result.type === "service" ? serviceSteps : complaintSteps;
  const stoppedEarly = result.status === "cancelled";
  const currentIndex = steps.indexOf(
    ["awaiting_parts", "awaiting_approval"].includes(result.status) ? "in_progress" : result.status
  );

  return (
    <div className={`${cardClass} mt-6`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-black/40">
            {result.type === "service" ? "Service Request" : "Complaint"} •{" "}
            {result.ticketNumber}
          </p>
          <h2 className="mt-1 text-xl font-bold">{result.title}</h2>
          <p className="mt-1 text-sm text-black/50">
            Raised {formatDateTime(result.createdAt)}
          </p>
        </div>
        <StatusBadge status={result.status} label={label(result.status)} />
      </div>

      {!stoppedEarly && (
        <ol className="mt-6 grid grid-cols-6 gap-1" aria-label="Progress">
          {steps.map((step, index) => {
            const done = index <= currentIndex;
            return (
              <li key={step} className="text-center">
                <div
                  className={`h-2 rounded-full ${done ? "bg-[#ff5e79]" : "bg-black/10"}`}
                />
                <p
                  className={`mt-2 text-[11px] font-semibold leading-tight sm:text-xs ${
                    done ? "text-black" : "text-black/40"
                  }`}
                >
                  {label(step)}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {result.notes && (
        <div className="mt-6 rounded-2xl border border-[#11b8d0]/20 bg-[#11b8d0]/5 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[#11b8d0]">
            Update from Seven Years
          </p>
          <p className="mt-1 text-sm leading-6">{result.notes}</p>
        </div>
      )}

      <dl className="mt-6 grid gap-4 rounded-2xl bg-[#f7f9fb] p-4 text-sm sm:grid-cols-2">
        {result.details
          .filter((d) => d.value)
          .map((d) => (
            <div key={d.label}>
              <dt className="text-xs font-semibold uppercase tracking-wider text-black/40">
                {d.label}
              </dt>
              <dd className="mt-1 font-semibold">
                {d.isDate ? formatDate(d.value) : d.value}
              </dd>
            </div>
          ))}
      </dl>

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-black/40">
          Description
        </p>
        <p className="mt-1 whitespace-pre-line text-sm leading-6 text-black/70">
          {result.description}
        </p>
      </div>

      {result.history.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-black/40">
            Timeline
          </p>
          <ol className="mt-3 space-y-4 border-l-2 border-black/10 pl-5">
            {[...result.history].reverse().map((item, index) => (
              <li key={`${item.createdAt}-${index}`} className="relative">
                <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-[#ff5e79] ring-4 ring-white" />
                <p className="text-sm font-bold">{label(item.status)}</p>
                <p className="text-xs text-black/50">{formatDateTime(item.createdAt)}</p>
                {item.note && <p className="mt-1 text-sm text-black/70">{item.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
