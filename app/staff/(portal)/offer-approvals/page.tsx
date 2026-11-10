import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/helpers";
import { isOfferApprover, type Offer } from "@/lib/offers";
import { RichText } from "@/components/RichText";
import { ApproveOfferButtons } from "@/components/OffersManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Offer approvals" };

// Offers made in "Offers & Notifications" wait here until the approver says yes.
export default async function OfferApprovalsPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (!isOfferApprover(staff.userId)) redirect("/staff");

  const [{ data: pending }, { data: decided }] = await Promise.all([
    supabaseAdmin.from("offers").select("*").eq("approval_status", "pending").order("created_at", { ascending: true }).limit(50),
    supabaseAdmin.from("offers").select("*").in("approval_status", ["approved", "rejected"]).not("approved_at", "is", null).order("approved_at", { ascending: false }).limit(15),
  ]);
  const waiting = (pending ?? []) as Offer[];

  const card = (o: Offer, actions: React.ReactNode) => (
    <div key={o.id} className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5">
      <p className="font-bold">{o.title}</p>
      <p className="mt-2 text-sm leading-6 text-black/70">
        <RichText text={o.message} />
      </p>
      {o.link && <p className="mt-1 break-all text-xs text-[#8883d7]">{o.link}</p>}
      <p className="mt-2 text-xs text-black/45">
        {formatDateTime(o.created_at)} · by {o.created_by}
        {o.valid_until ? ` · valid till ${formatDate(o.valid_until)}` : ""}
        {o.audience === "selected" ? ` · to ${(o.target_mobiles ?? []).length} chosen customer(s)` : " · to all customers"}
        {o.send_whatsapp ? " · also on WhatsApp" : ""}
      </p>
      <div className="mt-4 border-t border-black/5 pt-3">{actions}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">Offers</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Offers waiting for approval</h1>
        <p className="mt-1 text-sm text-black/55">Customers see an offer and get its notification only after you approve it.</p>
      </div>
      {waiting.length === 0 ? (
        <p className="rounded-3xl bg-white p-6 text-center text-sm text-black/55 soft-card ring-1 ring-black/5">Nothing waiting. 👍</p>
      ) : (
        waiting.map((o) => card(o, <ApproveOfferButtons id={o.id} />))
      )}
      {(decided ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">Recently decided</h2>
          {((decided ?? []) as Offer[]).map((o) =>
            card(
              o,
              <p className="text-sm">
                {o.approval_status === "approved" ? <b className="text-green-700">Approved</b> : <b className="text-red-700">Rejected</b>} by {o.approved_by} ·{" "}
                {o.approved_at ? formatDateTime(o.approved_at) : ""}
              </p>
            )
          )}
        </section>
      )}
    </div>
  );
}
