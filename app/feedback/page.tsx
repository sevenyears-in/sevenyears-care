import type { Metadata } from "next";
import { PageShell, cardClass } from "@/components/SiteChrome";
import { FeedbackFinder } from "@/components/FeedbackFinder";

export const metadata: Metadata = { title: "Give feedback" };

export default function GiveFeedbackPage() {
  return (
    <PageShell
      eyebrow="We're listening"
      title="Give feedback"
      intro="Tell us how we did — your purchase, a service visit or how we handled a complaint. It takes less than a minute."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { icon: "🛍️", title: "Your purchase", text: "Use your bill number, e.g. VDK26-SI1-8504", colour: "#ff5e79" },
          { icon: "🛠️", title: "A service", text: "Use your service number, e.g. SY-SRV-2026-950210", colour: "#8883d7" },
          { icon: "💬", title: "A complaint", text: "Use your complaint number, e.g. SY-CMP-2026-736504", colour: "#0fa8bf" },
        ].map((c) => (
          <div key={c.title} className="soft-card relative overflow-hidden rounded-3xl bg-white p-5 ring-1 ring-black/5">
            <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: c.colour }} aria-hidden />
            <span className="text-2xl" aria-hidden>
              {c.icon}
            </span>
            <p className="mt-2 font-bold">{c.title}</p>
            <p className="mt-1 text-xs leading-5 text-black/55">{c.text}</p>
          </div>
        ))}
      </div>
      <div className={`${cardClass} mt-6`}>
        <FeedbackFinder />
      </div>
    </PageShell>
  );
}
