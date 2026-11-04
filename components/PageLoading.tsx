// Shown instantly while a page loads (Next.js loading.tsx), so the app never looks frozen.

export function PageLoading({ label = "Loading…", compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className={`w-full ${compact ? "" : "mx-auto max-w-3xl px-4 py-8"}`} role="status" aria-live="polite">
      <div className="fixed inset-x-0 top-0 z-50 h-1 overflow-hidden" aria-hidden>
        <div className="sy-progress brand-stripe h-full w-1/3" />
      </div>
      <p className="sr-only">{label}</p>
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-56 rounded-2xl bg-black/[0.06]" />
        <div className="h-4 w-80 max-w-full rounded-xl bg-black/[0.05]" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-3xl bg-white ring-1 ring-black/5" />
          ))}
        </div>
        <div className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-black/5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-2xl bg-black/[0.04]" />
          ))}
        </div>
      </div>
    </div>
  );
}
