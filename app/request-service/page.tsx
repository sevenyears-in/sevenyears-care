import Link from "next/link";
import { PageShell } from "@/components/SiteChrome";
import { getStores } from "@/lib/stores";
import RequestServiceForm from "./RequestServiceForm";
import PaidServiceForm from "./PaidServiceForm";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RequestServicePage({ searchParams }: Props) {
  const params = await searchParams;
  const warranty = typeof params.warranty === "string" ? params.warranty : "";
  const paid = params.type === "paid";
  const stores = paid ? ((await getStores().catch(() => ({ stores: [] }))).stores ?? []).map((s) => s.name) : [];

  const tab = (active: boolean) =>
    `flex-1 rounded-2xl px-4 py-3 text-center text-sm font-bold transition ${
      active ? "bg-[#161616] text-white shadow-sm" : "bg-white text-black/60 ring-1 ring-black/10 hover:text-black"
    }`;

  return (
    <PageShell
      title="Request Service"
      intro="Something not working right? Tell us the problem and our service team will get in touch to arrange a repair."
    >
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <Link href="/request-service" className={tab(!paid)}>
          Under Seven Years Warranty
          <span className={`block text-xs font-normal ${paid ? "text-black/45" : "text-white/70"}`}>Product bought from us with a registered warranty</span>
        </Link>
        <Link href="/request-service?type=paid" className={tab(paid)}>
          Paid Service
          <span className={`block text-xs font-normal ${paid ? "text-white/70" : "text-black/45"}`}>Bought elsewhere, or warranty not applicable</span>
        </Link>
      </div>
      {paid ? <PaidServiceForm stores={stores} /> : <RequestServiceForm initialWarrantyNumber={warranty} />}
    </PageShell>
  );
}
