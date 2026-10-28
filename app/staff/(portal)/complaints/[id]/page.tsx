import { TicketDetailPage } from "@/components/TicketPages";

export default function ComplaintDetail({ params }: { params: Promise<{ id: string }> }) {
  return <TicketDetailPage type="complaint" params={params} />;
}
