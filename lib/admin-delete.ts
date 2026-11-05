// Super Admin only: permanently delete a service request, complaint or warranty,
// together with everything that belongs to it.

import { supabaseAdmin } from "@/lib/supabase/server";
import { PHOTO_BUCKET } from "@/lib/service-photos";
import type { TicketType } from "@/lib/sla";

const TABLE: Record<TicketType, string> = { service: "service_requests", complaint: "complaints" };

async function must(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p;
  if (error) throw new Error(error.message);
}

export async function deleteTicket(type: TicketType, id: string) {
  if (type === "service") {
    const { data } = await supabaseAdmin.from("service_requests").select("photos").eq("id", id).maybeSingle();
    const photos = ((data?.photos as string[] | null) ?? []).filter(Boolean);
    if (photos.length) await supabaseAdmin.storage.from(PHOTO_BUCKET).remove(photos);
  }
  await must(supabaseAdmin.from("ticket_status_history").delete().eq("ticket_type", type).eq("ticket_id", id));
  await must(supabaseAdmin.from("ticket_explanations").delete().eq("ticket_type", type).eq("ticket_id", id));
  await must(supabaseAdmin.from("staff_notifications").delete().eq("ticket_type", type).eq("ticket_id", id));
  await must(supabaseAdmin.from("customer_feedback").delete().eq("kind", type).eq("ref_id", id));
  await must(supabaseAdmin.from(TABLE[type]).delete().eq("id", id));
}

/** Returns an error message when the warranty still has service requests / complaints. */
export async function deleteWarranty(id: string): Promise<string | null> {
  const [{ count: services }, { count: complaints }] = await Promise.all([
    supabaseAdmin.from("service_requests").select("id", { count: "exact", head: true }).eq("warranty_id", id),
    supabaseAdmin.from("complaints").select("id", { count: "exact", head: true }).eq("warranty_id", id),
  ]);
  if ((services ?? 0) + (complaints ?? 0) > 0) {
    return `This warranty has ${services ?? 0} service request(s) and ${complaints ?? 0} complaint(s). Delete those first, or void the warranty instead.`;
  }
  await must(supabaseAdmin.from("warranty_extensions").delete().eq("warranty_id", id));
  await must(supabaseAdmin.from("customer_feedback").delete().eq("kind", "sales").eq("ref_id", id));
  await must(supabaseAdmin.from("warranties").delete().eq("id", id));
  return null;
}
