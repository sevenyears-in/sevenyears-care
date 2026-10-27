import { PageShell } from "@/components/SiteChrome";
import RequestServiceForm from "./RequestServiceForm";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RequestServicePage({ searchParams }: Props) {
  const params = await searchParams;
  const warranty = typeof params.warranty === "string" ? params.warranty : "";

  return (
    <PageShell
      title="Request Service"
      intro="Something not working right? Tell us the problem and our service team will get in touch to arrange a repair."
    >
      <RequestServiceForm initialWarrantyNumber={warranty} />
    </PageShell>
  );
}
