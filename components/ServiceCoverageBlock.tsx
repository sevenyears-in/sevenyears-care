import { issuingStore, isServiceCoverage, SERVICE_COVERAGE } from "@/lib/warranty-coverage";

/** "ON-SITE WARRANTY / Issuing store / what it means". Shows nothing for warranties without a type (issued before it was added). */
export function ServiceCoverageBlock({ coverage, store, className = "" }: { coverage: unknown; store: string | null | undefined; className?: string }) {
  if (!isServiceCoverage(coverage)) return null;
  const c = SERVICE_COVERAGE[coverage];
  const onSite = coverage === "on_site";
  return (
    <section className={`rounded-2xl border p-5 ${onSite ? "border-[#11b8d0]/30 bg-[#11b8d0]/5" : "border-[#ff5e79]/30 bg-[#ff5e79]/5"} ${className}`}>
      <p className={`text-sm font-extrabold tracking-[0.12em] ${onSite ? "text-[#0e8fa3]" : "text-[#d6224a]"}`}>{c.badge}</p>
      <p className="mt-1 text-sm font-semibold">Issuing store: {issuingStore(store)}</p>
      <p className="mt-1 text-sm text-black/65">{c.certificate}</p>
    </section>
  );
}
