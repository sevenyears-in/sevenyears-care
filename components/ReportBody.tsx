import type { ReportSeg, Tone } from "@/lib/report-parse";

// A sales update / closing report as a clean card: store name in bold with a line under it,
// one figure per line (label left, value right), colour only where it means something.

const TONE: Record<Exclude<Tone, null>, string> = {
  good: "text-green-700",
  bad: "text-red-700",
  warn: "text-amber-700",
  muted: "text-black/45",
};

export function ReportBody({ segs, compact = false }: { segs: ReportSeg[]; compact?: boolean }) {
  return (
    <div className={`space-y-3 ${compact ? "text-xs" : "text-sm"}`}>
      {segs.map((s, i) => {
        if (s.kind === "store")
          return (
            <div key={i} className="rounded-2xl bg-white px-4 py-3 ring-1 ring-black/10">
              <div className="flex items-baseline justify-between gap-2 border-b-2 border-[#8883d7] pb-1.5">
                <p className="text-base font-extrabold tracking-wide text-black">{s.store}</p>
                <p className="shrink-0 text-xs font-semibold text-black/50">
                  {s.date.slice(0, 5)} · {s.when}
                </p>
              </div>
              <dl className="mt-1 divide-y divide-black/[0.06]">
                {s.rows.map((r) => (
                  <div key={r.label} className="flex items-baseline justify-between gap-3 py-1.5">
                    <dt className="shrink-0 text-black/55">{r.label}</dt>
                    <dd className={`text-right font-bold tabular-nums ${r.tone ? TONE[r.tone] : "text-black"}`}>{r.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        if (s.kind === "total") return <p key={i} className="rounded-xl bg-[#8883d7]/10 px-4 py-2 font-extrabold text-black">{s.text}</p>;
        if (s.kind === "heading") return <p key={i} className="pt-1 font-extrabold text-black">{s.text}</p>;
        if (s.kind === "item")
          return (
            <div key={i} className="-mt-2 flex items-baseline justify-between gap-3 border-b border-black/[0.06] px-1 py-1">
              <span className="min-w-0 truncate text-black/70">{s.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-black">{s.value}</span>
            </div>
          );
        if (s.kind === "link") return null; // the whole alert already opens the page
        return (
          <p key={i} className={`${s.tone ? TONE[s.tone] : "text-black/70"} ${s.tone === "muted" ? "text-xs" : ""}`}>
            {s.tone === "warn" ? "⚠ " : ""}
            {s.text}
          </p>
        );
      })}
    </div>
  );
}
