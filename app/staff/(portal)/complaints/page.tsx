import { TicketListPage } from "@/components/TicketPages";

export default function ComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return <TicketListPage type="complaint" searchParams={searchParams} />;
}
