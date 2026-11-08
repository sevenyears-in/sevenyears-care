"use client";

import { useState } from "react";
import type { FamilyDates } from "@/lib/family-types";
import { FamilyDatesFields } from "@/components/FamilyDatesFields";

/** My Account: customer keeps their family's special dates up to date. */
export function FamilyDatesEditor({ initial }: { initial: FamilyDates }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/account/family", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMessage({ ok: false, text: data.error || "Could not save. Please try again." });
      else {
        setValue(data.family);
        setMessage({ ok: true, text: "Saved. Thank you!" });
      }
    } catch {
      setMessage({ ok: false, text: "Could not save. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <FamilyDatesFields value={value} onChange={setValue} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-2xl bg-[#8883d7] px-6 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save special dates"}
        </button>
        {message && <p className={`text-sm font-semibold ${message.ok ? "text-green-700" : "text-red-700"}`}>{message.text}</p>}
      </div>
    </div>
  );
}
