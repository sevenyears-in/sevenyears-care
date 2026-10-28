"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorBox, inputClass, labelClass } from "@/components/SiteChrome";
import type { ActionName } from "@/lib/tickets";

type Option = { value: string; label: string };

type Props = {
  type: "service" | "complaint";
  id: string;
  actions: ActionName[];
  people: { id: string; label: string }[];
  currentAssigneeId: string | null;
  severity: string | null;
  priority: string;
  severities: Option[];
  priorities: Option[];
  resolutions: Option[];
};

type Field = "note" | "customerNote" | "severity" | "priority" | "assignee" | "resolution" | "visibility";

const CONFIG: Record<
  ActionName,
  { label: string; help: string; fields: Field[]; required?: Field[]; tone?: "primary" | "danger" | "plain" }
> = {
  acknowledge: {
    label: "Acknowledge",
    help: "Tell the customer we've received it. Do this within 2 hours.",
    fields: [],
    tone: "primary",
  },
  triage: {
    label: "Classify / priority",
    help: "Sets the resolution deadline (SOP time limits).",
    fields: ["severity", "priority", "note"],
  },
  assign: { label: "Assign", help: "Give the job to one person. They get an alert.", fields: ["assignee", "note"], required: ["assignee"], tone: "primary" },
  start: { label: "Start work", help: "Customer sees the status change.", fields: ["customerNote"] },
  awaiting_parts: {
    label: "Waiting for parts",
    help: "Tell the customer which part and the expected date.",
    fields: ["customerNote"],
    required: ["customerNote"],
  },
  request_approval: {
    label: "Request replacement",
    help: "Service Head / Super Admin must approve (DOA or non-repairable).",
    fields: ["note"],
    required: ["note"],
  },
  approve: { label: "Approve replacement", help: "The technician is alerted.", fields: ["customerNote", "note"], tone: "primary" },
  reject: { label: "Don't approve", help: "Explain why; the technician continues the repair.", fields: ["note"], required: ["note"], tone: "danger" },
  resolve: {
    label: "Mark resolved",
    help: "Customer is told what was done and can ask to reopen.",
    fields: ["resolution", "customerNote", "note"],
    required: ["resolution", "customerNote"],
    tone: "primary",
  },
  close: { label: "Close", help: "Only after the customer confirms they're happy.", fields: ["note"] },
  reopen: { label: "Reopen", help: "Customer is not satisfied or the problem came back.", fields: ["note"], required: ["note"] },
  cancel: { label: "Cancel request", help: "The reason is shown to the customer.", fields: ["customerNote"], required: ["customerNote"], tone: "danger" },
  note: { label: "Add note / update", help: "Staff-only note, or an update the customer will see.", fields: ["visibility", "note"], required: ["note"] },
};

export function TicketActions(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<ActionName | null>(null);
  const [note, setNote] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [severity, setSeverity] = useState(props.severity ?? "");
  const [priority, setPriority] = useState(props.priority);
  const [assigneeId, setAssigneeId] = useState(props.currentAssigneeId ?? "");
  const [resolutionType, setResolutionType] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "customer">("internal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const choose = (action: ActionName) => {
    setError("");
    setDone("");
    setNote("");
    setCustomerNote("");
    setResolutionType("");
    setVisibility("internal");
    setOpen(open === action ? null : action);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!open) return;
    setError("");
    setSaving(true);

    const response = await fetch(`/api/staff/tickets/${props.type}/${props.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: open,
        note,
        customerNote: open === "note" && visibility === "customer" ? note : customerNote,
        severity: severity || undefined,
        priority,
        assigneeId,
        resolutionType,
        visibility,
      }),
    }).catch(() => null);

    const data = response ? await response.json().catch(() => ({})) : {};
    setSaving(false);

    if (!response || !response.ok) {
      setError(data.error || "Unable to save. Please try again.");
      return;
    }

    setDone(`${CONFIG[open].label} — saved.`);
    setOpen(null);
    router.refresh();
  };

  const visible = props.actions.filter((a) => a !== "note");

  return (
    <aside className="space-y-4">
      <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <h2 className="text-lg font-bold">Next step</h2>
        {visible.length === 0 && props.actions.length <= 1 && (
          <p className="mt-2 text-sm text-black/55">No actions for you on this request right now.</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {props.actions.map((action) => {
            const cfg = CONFIG[action];
            const tone =
              cfg.tone === "primary"
                ? "bg-[#ff5e79] text-white"
                : cfg.tone === "danger"
                  ? "bg-red-50 text-red-700"
                  : "border border-black/10 bg-white";
            return (
              <button
                key={action}
                type="button"
                onClick={() => choose(action)}
                className={`rounded-xl px-3 py-2 text-sm font-bold transition hover:opacity-90 ${tone} ${
                  open === action ? "ring-2 ring-[#161616]" : ""
                }`}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>

        {done && (
          <p className="mt-4 rounded-2xl bg-green-50 p-3 text-sm font-semibold text-green-800" role="status">
            {done}
          </p>
        )}

        {open && (
          <form onSubmit={submit} className="mt-5 space-y-4 border-t border-black/5 pt-5">
            <p className="text-sm text-black/60">{CONFIG[open].help}</p>

            {CONFIG[open].fields.includes("severity") && (
              <div>
                <label htmlFor="severity" className={labelClass}>Classification</label>
                <select id="severity" value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputClass}>
                  <option value="">Not classified</option>
                  {props.severities.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}

            {CONFIG[open].fields.includes("priority") && (
              <div>
                <label htmlFor="priority" className={labelClass}>Priority</label>
                <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
                  {props.priorities.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}

            {CONFIG[open].fields.includes("assignee") && (
              <div>
                <label htmlFor="assignee" className={labelClass}>
                  {props.type === "service" ? "Technician *" : "Owner *"}
                </label>
                <select id="assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputClass}>
                  <option value="">Choose…</option>
                  {props.people.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                {props.people.length === 0 && (
                  <p className="mt-2 text-xs text-red-700">
                    No {props.type === "service" ? "technicians" : "owners"} set up yet. Add them in Staff Users.
                  </p>
                )}
              </div>
            )}

            {CONFIG[open].fields.includes("resolution") && (
              <div>
                <label htmlFor="resolution" className={labelClass}>How was it resolved? *</label>
                <select id="resolution" value={resolutionType} onChange={(e) => setResolutionType(e.target.value)} className={inputClass}>
                  <option value="">Choose…</option>
                  {props.resolutions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}

            {CONFIG[open].fields.includes("visibility") && (
              <fieldset className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={visibility === "internal"} onChange={() => setVisibility("internal")} />
                  Staff only
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={visibility === "customer"} onChange={() => setVisibility("customer")} />
                  Send to customer
                </label>
              </fieldset>
            )}

            {CONFIG[open].fields.includes("customerNote") && (
              <div>
                <label htmlFor="customerNote" className={labelClass}>
                  Message to customer{CONFIG[open].required?.includes("customerNote") ? " *" : " (optional)"}
                </label>
                <textarea
                  id="customerNote"
                  rows={3}
                  maxLength={1000}
                  value={customerNote}
                  onChange={(e) => setCustomerNote(e.target.value)}
                  className={inputClass}
                  placeholder="The customer receives this on WhatsApp and sees it on Track Request."
                />
              </div>
            )}

            {CONFIG[open].fields.includes("note") && (
              <div>
                <label htmlFor="note" className={labelClass}>
                  {open === "note"
                    ? visibility === "customer" ? "Update for the customer *" : "Staff note *"
                    : `Staff note${CONFIG[open].required?.includes("note") ? " *" : " (optional)"}`}
                </label>
                <textarea
                  id="note"
                  rows={3}
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={inputClass}
                  placeholder={open === "note" && visibility === "customer" ? "Shown to the customer." : "Only staff can see this."}
                />
              </div>
            )}

            <ErrorBox message={error} />

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-2xl bg-[#161616] px-5 py-3 font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : `Confirm: ${CONFIG[open].label}`}
            </button>
          </form>
        )}
      </div>

      <div className="rounded-3xl bg-white p-5 text-xs leading-5 text-black/55 shadow-sm ring-1 ring-black/5">
        <p className="font-bold text-black/70">Process</p>
        {props.type === "service" ? (
          <p className="mt-1">
            Acknowledge (2 hrs) → Classify → Assign technician → Start → (Parts / Replacement approval) → Resolve → Close after customer confirms.
          </p>
        ) : (
          <p className="mt-1">
            Acknowledge (2 hrs) → Classify → Assign owner → Investigate → Resolve → Close after customer confirms. Staff behaviour complaints are led by HR.
          </p>
        )}
      </div>
    </aside>
  );
}
