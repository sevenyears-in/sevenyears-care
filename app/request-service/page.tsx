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

  // Logo colours: teal for warranty, orange for paid service.
  const tab = (active: boolean, colour: string) => ({
    className: `flex-1 rounded-2xl border-2 px-4 py-3 text-center text-sm font-bold transition ${
      active ? "text-white shadow-md" : "bg-white hover:shadow-sm"
    }`,
    style: active
      ? { background: `linear-gradient(135deg, ${colour}, ${colour}d9)`, borderColor: colour }
      : { borderColor: `${colour}55`, color: colour },
  });

  return (
    <PageShell
      title="Request Service"
      intro="Something not working right? Tell us the problem and our service team will get in touch to arrange a repair."
    >
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <Link href="/request-service" {...tab(!paid, "#0fa8bf")}>
          🛡️ Under Seven Years Warranty
          <span className={`block text-xs font-normal ${paid ? "text-black/50" : "text-white/85"}`}>Product bought from us with a registered warranty</span>
        </Link>
        <Link href="/request-service?type=paid" {...tab(paid, "#f39237")}>
          🔧 Paid Service
          <span className={`block text-xs font-normal ${paid ? "text-white/85" : "text-black/50"}`}>Bought elsewhere, or warranty not applicable</span>
        </Link>
      </div>
      {paid ? <PaidServiceForm stores={stores} /> : <RequestServiceForm initialWarrantyNumber={warranty} />}
    </PageShell>
  );
}
