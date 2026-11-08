// Records who has seen an offer (server only). Never blocks the page: errors are only logged.
import { supabaseAdmin } from "@/lib/supabase/server";

export type Viewer = { customerMobile?: string | null; staffId?: string | null };

function key(v: Viewer) {
  if (v.staffId) return `s:${v.staffId}`;
  if (v.customerMobile) return `c:${v.customerMobile}`;
  return null;
}

/** First time this person sees these offers (Offers page, home page banner). */
export async function recordOfferViews(offerIds: string[], v: Viewer) {
  const viewer = key(v);
  if (!viewer || offerIds.length === 0) return;
  try {
    await supabaseAdmin.from("offer_views").upsert(
      offerIds.map((offer_id) => ({ offer_id, viewer, customer_mobile: v.customerMobile ?? null, staff_id: v.staffId ?? null })),
      { onConflict: "offer_id,viewer", ignoreDuplicates: true }
    );
  } catch (e) {
    console.error("Offer views:", e);
  }
}

/** Opened the offer by tapping the notification. */
export async function recordOfferTap(offerId: string, v: Viewer) {
  const viewer = key(v);
  if (!viewer || !/^[0-9a-f-]{36}$/i.test(offerId)) return;
  try {
    const now = new Date().toISOString();
    await supabaseAdmin.from("offer_views").upsert(
      { offer_id: offerId, viewer, customer_mobile: v.customerMobile ?? null, staff_id: v.staffId ?? null, tapped_at: now },
      { onConflict: "offer_id,viewer", ignoreDuplicates: true }
    );
    await supabaseAdmin.from("offer_views").update({ tapped_at: now }).eq("offer_id", offerId).eq("viewer", viewer).is("tapped_at", null);
  } catch (e) {
    console.error("Offer tap:", e);
  }
}
