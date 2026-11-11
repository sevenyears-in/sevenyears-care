"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SERVICE_COVERAGE, type ServiceCoverage } from "@/lib/warranty-coverage";

/** Super Admin: set or change the warranty service type (also on warranties issued before it existed). */
export function SetServiceCoverage({ id, value }: { id: string; value: ServiceCoverage | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (coverage: ServiceCoverage | "") => {
    const text = coverage ? SERVICE_COVERAGE[coverage].title : "Not set";
    if (!confirm(`Change the warranty service type to “${text}”? The certificate will show it straight away.`)) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/staff/warranties/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "coverage", coverage }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "Unable to save.");
    router.refresh();
  };
  return (
    <div className="mt-3">
      <select
        className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
        value={value ?? ""}
        disabled={busy}
        onChange={(e) => save(e.target.value as ServiceCoverage | "")}
      >
        <option value="">Not set</option>
        {(Object.keys(SERVICE_COVERAGE) as ServiceCoverage[]).map((k) => (
          <option key={k} value={k}>
            {SERVICE_COVERAGE[k].title}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
