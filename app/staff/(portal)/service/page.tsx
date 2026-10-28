import { TicketListPage } from "@/components/TicketPages";

export default function ServiceRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return <TicketListPage type="service" searchParams={searchParams} />;
}
