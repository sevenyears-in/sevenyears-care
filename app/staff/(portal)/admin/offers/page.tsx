import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadServiceAccount } from "@/lib/push";
import { formatDate, formatDateTime } from "@/lib/helpers";
import { DeleteOfferButton, OffersManager, ResendOfferButton, PushSetup, StopOfferButton, WishesSettings } from "@/components/OffersManager";
import { loadWishSettings } from "@/lib/wishes";
import { RichText } from "@/components/RichText";
import type { Offer } from "@/lib/offers";

export const dynamic = "force-dynamic";

export default async function OffersAdminPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  const [{ data, error }, sa, wishSettings, recentWishes, viewsRes] = await Promise.all([
    supabaseAdmin.from("offers").select("*").order("created_at", { ascending: false }).limit(50),
    loadServiceAccount().catch(() => null),
    loadWishSettings(),
    supabaseAdmin.from("customer_wishes_sent").select("mobile, kind, detail, wish_date, sent, error").order("created_at", { ascending: false }).limit(15),
    supabaseAdmin.from("offer_views").select("offer_id, tapped_at").limit(50000),
  ]);
  const seen = new Map<string, { seen: number; tapped: number }>();
  for (const v of (viewsRes.data ?? []) as { offer_id: string; tapped_at: string | null }[]) {
    const s = seen.get(v.offer_id) ?? { seen: 0, tapped: 0 };
    s.seen++;
    if (v.tapped_at) s.tapped++;
    seen.set(v.offer_id, s);
  }
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
        <Link href="/staff/admin/app-usage" className="mt-3 inline-block text-sm font-bold text-[#8883d7] hover:underline">
          📊 App usage — who uses the app and who saw each offer →
        </Link>
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

      <WishesSettings initial={wishSettings} />
      {(recentWishes.data ?? []).length > 0 && (
        <details className="rounded-3xl bg-white p-5 text-sm soft-card ring-1 ring-black/5">
          <summary className="cursor-pointer font-bold">Recent wishes ({(recentWishes.data ?? []).length})</summary>
          <ul className="mt-3 space-y-1 text-black/65">
            {(recentWishes.data ?? []).map((w, i) => (
              <li key={i}>
                {formatDate(w.wish_date)} · +91 {w.mobile} ·{" "}
                {{ child_birthday: `Birthday of ${w.detail}`, father_birthday: "Father's birthday", mother_birthday: "Mother's birthday", anniversary: "Anniversary" }[
                  w.kind as string
                ] ?? w.kind}{" "}
                · {w.sent ? <span className="text-green-700">sent</span> : <span className="text-black/40">{w.error ?? "pending"}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

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
                  <p className="mt-2 text-sm leading-6 text-black/70">
                    <RichText text={o.message} />
                  </p>
                  <p className="mt-2 text-xs text-black/45">
                    {formatDateTime(o.created_at)} · {o.created_by}
                    {o.valid_until ? ` · valid till ${formatDate(o.valid_until)}` : ""}
                    {o.audience === "selected" ? ` · to ${(o.target_mobiles ?? []).length} chosen customer(s)` : " · to all customers"}
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
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-black/5 pt-3 text-sm">
                <Link href="/staff/admin/app-usage" className="font-bold text-black/60 hover:underline">
                  👀 Seen by {seen.get(o.id)?.seen ?? 0}
                  {seen.get(o.id)?.tapped ? ` · 🔔 ${seen.get(o.id)!.tapped} opened` : ""}
                </Link>
                <ResendOfferButton id={o.id} />
                {o.is_active ? <StopOfferButton id={o.id} /> : <span className="text-black/40">Hidden</span>}
                <DeleteOfferButton id={o.id} />
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
