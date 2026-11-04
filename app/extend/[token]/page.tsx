import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell, cardClass } from "@/components/SiteChrome";
import { ExtendPanel } from "@/components/ExtendPanel";
import { formatDate } from "@/lib/helpers";
import {
  canPayNow,
  eligibility,
  extendedSettings,
  isApprovedInspection,
  onlinePaymentsReady,
  rupees,
  warrantyByToken,
} from "@/lib/extended-warranty";

export const metadata: Metadata = { title: "Extended Warranty", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ExtendPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const w = await warrantyByToken(token);
  if (!w) notFound();
  const s = await extendedSettings();
  const e = await eligibility(w, s);

  const status = !e.ok
    ? "not_eligible"
    : e.request?.status === "pending_inspection"
      ? "pending_inspection"
      : isApprovedInspection(e.request)
        ? "approved"
        : canPayNow(e)
          ? "pay"
          : e.request?.status === "inspection_failed"
            ? "failed"
            : "inspection";

  return (
    <PageShell
      eyebrow="Extended Warranty"
      title={`Extend your warranty by ${s.months} months`}
      intro={`${w.product_name} · ${w.warranty_number}`}
    >
      <div className={cardClass}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Info label="Price" value={rupees(e.ok ? e.price : s.price)} big />
          <Info label="Covered until now" value={formatDate(w.warranty_expiry_date)} />
          <Info label="With extended warranty" value={e.ok ? formatDate(e.newExpiry) : "—"} accent />
        </div>

        <div className="mt-6">
          {status === "not_eligible" && !e.ok && (
            <p className="rounded-2xl bg-[#f7f9fb] p-4 text-sm font-semibold text-black/70">{e.reason}</p>
          )}
          {status === "pending_inspection" && (
            <Notice tone="amber">
              Your inspection request has been received. Our technician will check the product and we will message you on
              WhatsApp. Once it is approved you can pay here.
            </Notice>
          )}
          {status === "failed" && e.ok && (
            <Notice tone="red">
              After inspection the product could not be covered{e.request?.inspection_note ? `: ${e.request.inspection_note}` : "."}{" "}
              Please contact the store for help.
            </Notice>
          )}
          {(status === "pay" || status === "approved" || status === "inspection" || status === "failed") && e.ok && (
            <ExtendPanel
              token={token}
              mode={status === "pay" || status === "approved" ? "pay" : "inspection"}
              approved={status === "approved"}
              online={onlinePaymentsReady(s)}
              priceLabel={rupees(e.price)}
              directUntil={formatDate(e.directUntil)}
              windowDays={s.windowDays}
            />
          )}
        </div>
      </div>

      <div className="mt-6 rounded-3xl bg-white/70 p-5 text-xs leading-6 text-black/55 ring-1 ring-black/5">
        <p className="font-bold text-black/70">How it works</p>
        <p>
          • Within {s.windowDays} days of purchase you can buy the extended warranty straight away.
          <br />• After that, while your warranty is still running, a quick technician inspection is needed first.
          <br />• The extension starts when your standard warranty ends and adds {s.months} months.
        </p>
        <Link href={`/warranty/${token}`} className="mt-2 inline-block font-bold text-[#0fa8bf]">
          ← Back to the certificate
        </Link>
      </div>
    </PageShell>
  );
}

function Info({ label, value, big, accent }: { label: string; value: string; big?: boolean; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${accent ? "bg-[#ff5e79]/5 ring-1 ring-[#ff5e79]/20" : "bg-[#f7f9fb]"}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-black/45">{label}</p>
      <p className={`mt-1 font-bold ${big ? "text-2xl" : ""} ${accent ? "text-[#ff5e79]" : ""}`}>{value}</p>
    </div>
  );
}

function Notice({ tone, children }: { tone: "amber" | "red"; children: React.ReactNode }) {
  return (
    <p
      className={`rounded-2xl p-4 text-sm font-semibold ${
        tone === "amber" ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-red-50 text-red-800 ring-1 ring-red-200"
      }`}
    >
      {children}
    </p>
  );
}
