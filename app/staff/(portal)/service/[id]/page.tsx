import { TicketDetailPage } from "@/components/TicketPages";

export default function ServiceRequestDetail({ params }: { params: Promise<{ id: string }> }) {
  return <TicketDetailPage type="service" params={params} />;
}
