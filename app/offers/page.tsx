import type { Metadata } from "next";
import { PageShell } from "@/components/SiteChrome";
import { currentOffers } from "@/lib/offers";
import { formatDate } from "@/lib/helpers";

export const metadata: Metadata = { title: "Offers" };
export const dynamic = "force-dynamic";

const COLOURS = ["#ff5e79", "#8883d7", "#f39237", "#0fa8bf"];

export default async function OffersPage() {
  const offers = await currentOffers();
  return (
    <PageShell eyebrow="Seven Years" title="Offers for you 🎁" intro="Special offers from Seven Years stores. Turn on notifications in the app so you never miss one.">
      {offers.length === 0 ? (
        <p className="rounded-3xl bg-white p-6 text-center text-sm text-black/55 soft-card ring-1 ring-black/5">No offers right now — check back soon!</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {offers.map((o, i) => (
            <article key={o.id} className="relative overflow-hidden rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5">
              <span className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundColor: COLOURS[i % COLOURS.length] }} aria-hidden />
              <h2 className="text-lg font-bold">{o.title}</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-black/70">{o.message}</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-black/45">{o.valid_until ? `Valid till ${formatDate(o.valid_until)}` : formatDate(o.created_at.slice(0, 10))}</p>
                {o.link && (
                  <a href={o.link} className="rounded-2xl px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: COLOURS[i % COLOURS.length] }}>
                    View offer
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </PageShell>
  );
}
