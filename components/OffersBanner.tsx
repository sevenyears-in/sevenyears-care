import Link from "next/link";
import { after } from "next/server";
import { recordOfferViews } from "@/lib/offer-views";
import { currentOffers } from "@/lib/offers";
import { formatDate } from "@/lib/helpers";
import { RichText } from "@/components/RichText";

const COLOURS = ["#ff5e79", "#8883d7", "#f39237", "#0fa8bf"];

/** Current offers, shown on the home pages so they stay visible after the notification is gone. */
export async function OffersBanner({
  mobile,
  staffId,
  max = 2,
  className = "",
}: {
  mobile?: string | null;
  staffId?: string | null;
  max?: number;
  className?: string;
}) {
  const offers = (await currentOffers(mobile)).slice(0, max);
  if (offers.length === 0) return null;
  if (mobile || staffId) after(() => recordOfferViews(offers.map((o) => o.id), { customerMobile: mobile, staffId }));
  return (
    <section className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">🎁 Offers for you</h2>
        <Link href="/offers" className="text-sm font-bold text-[#8883d7] hover:underline">
          See all →
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {offers.map((o, i) => (
          <Link
            key={o.id}
            href={o.link || "/offers"}
            className="relative block overflow-hidden rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 transition hover:-translate-y-0.5"
          >
            <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: COLOURS[i % COLOURS.length] }} aria-hidden />
            <p className="font-bold">{o.title}</p>
            <p className="mt-1 line-clamp-4 text-sm leading-6 text-black/65">
              <RichText text={o.message} />
            </p>
            {o.valid_until && <p className="mt-2 text-xs text-black/45">Valid till {formatDate(o.valid_until)}</p>}
          </Link>
        ))}
      </div>
    </section>
  );
}
