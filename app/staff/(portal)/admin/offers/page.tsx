import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadServiceAccount } from "@/lib/push";
import { formatDate, formatDateTime } from "@/lib/helpers";
import { OffersManager, PushSetup, StopOfferButton } from "@/components/OffersManager";
import type { Offer } from "@/lib/offers";

export const dynamic = "force-dynamic";

export default async function OffersAdminPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  const [{ data, error }, sa] = await Promise.all([
    supabaseAdmin.from("offers").select("*").order("created_at", { ascending: false }).limit(50),
    loadServiceAccount().catch(() => null),
  ]);
  const offers = (data ?? []) as Offer[];

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-[linear-gradient(90deg,#ff5e79,#8883d7,#f39237,#0fa8bf)]" aria-hidden />
        <h1 className="text-3xl font-bold">Offers &amp; Notifications 📣</h1>
        <p className="mt-2 text-sm text-black/60">
          Send an offer to every customer who has the Seven Years Care app. It arrives as a phone notification and stays on the
          Offers page (care.sevenyears.in/offers) until its last date.
        </p>
      </div>

      {error && (
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">Offers are not set up in the database yet. Run the latest database update.</p>
      )}

      {!sa && staff.role === "super_admin" && <PushSetup />}
      {!sa && staff.role !== "super_admin" && (
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">Phone notifications are not switched on yet — the Super Admin needs to finish the setup.</p>
      )}
      {sa && <p className="text-xs text-green-700">✓ Phone notifications are switched on.</p>}

      <OffersManager />

      <section className="space-y-3">
        <h2 className="text-xl font-bold">Sent offers</h2>
        {offers.length === 0 ? (
          <p className="rounded-3xl bg-white p-6 text-center text-sm text-black/55 soft-card ring-1 ring-black/5">No offers yet.</p>
        ) : (
          offers.map((o) => (
            <div key={o.id} className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{o.title}</p>
                  <p className="mt-1 text-sm text-black/65">{o.message}</p>
                  <p className="mt-2 text-xs text-black/45">
                    {formatDateTime(o.created_at)} · {o.created_by}
                    {o.valid_until ? ` · valid till ${formatDate(o.valid_until)}` : ""}
                  </p>
                </div>
                <div className="text-right text-xs">
                  {o.sent_at ? (
                    <span className="rounded-full bg-green-100 px-2.5 py-1 font-bold text-green-800">Notified</span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 font-bold text-amber-800" title={o.send_error ?? ""}>
                      Not notified
                    </span>
                  )}
                  <p className="mt-2">{o.is_active ? <StopOfferButton id={o.id} /> : <span className="text-black/40">Hidden</span>}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
