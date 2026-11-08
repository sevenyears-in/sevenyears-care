import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { HomeTrackForm } from "@/components/HomeTrackForm";
import { InstallAppCard } from "@/components/InstallApp";
import { ACK_HOURS } from "@/lib/sla";
import { OffersBanner } from "@/components/OffersBanner";

// Offers change from the staff portal, so the home page is refreshed every minute.
export const dynamic = "force-dynamic"; // offers & figures always current

const steps = [
  {
    title: "Tell us what happened",
    text: "Takes 2 minutes. You get a request number straight away on WhatsApp.",
  },
  {
    title: "We call you back",
    text: `Our team contacts you within ${ACK_HOURS} working hours and plans the fix.`,
  },
  {
    title: "Sorted, with updates",
    text: "Follow every step here. Most repairs are done in 2–3 days.",
  },
];

const faqs = [
  {
    q: "Service or complaint — which one do I choose?",
    a: "Choose Request Service if the product isn't working, is damaged, or needs assembly. Choose Register a Complaint for anything else — billing, delivery, staff behaviour or product quality.",
  },
  {
    q: "What do I need for a service request?",
    a: "Your mobile number and the warranty number from your certificate. Don't have it? Find it under “Find my warranty” with your mobile and bill number.",
  },
  {
    q: "Is a brake, lock or frame problem urgent?",
    a: "Yes. Please stop using the product and raise a service request — safety issues go to the top of our list.",
  },
  {
    q: "My product is out of warranty. Can you still help?",
    a: "Yes. We'll still repair it; our team will share the cost and get your approval before starting.",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#f7f9fb] text-[#161616]">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero: the two things customers come for */}
        <div className="brand-wash">
        <section className="mx-auto grid w-full max-w-7xl gap-8 px-5 pb-12 pt-10 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12 lg:pt-16">
          <div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-[#ff5e79] soft-card ring-1 ring-black/5">
              <span className="flex gap-1" aria-hidden>
                <span className="h-2 w-2 rounded-full bg-[#ff5e79]" />
                <span className="h-2 w-2 rounded-full bg-[#8883d7]" />
                <span className="h-2 w-2 rounded-full bg-[#ffa95a]" />
                <span className="h-2 w-2 rounded-full bg-[#11b8d0]" />
              </span>
              Seven Years Care
            </div>

            <h1 className="mt-6 max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Something not right? <span className="text-[#ff5e79]">We&apos;re here to help.</span>
            </h1>

            <p className="mt-4 max-w-xl text-base leading-7 text-black/60 sm:text-lg">
              Tell us what&apos;s wrong and we&apos;ll take it from there — with a real person calling you back.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <Link
                href="/request-service"
                className="group relative overflow-hidden rounded-3xl bg-[#161616] p-6 text-white shadow-xl shadow-black/10 transition hover:-translate-y-1 hover:shadow-2xl"
              >
                <span className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[#ff5e79]/25 blur-2xl" aria-hidden />
                <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-2xl">🛠️</div>
                <h2 className="mt-5 text-2xl font-bold">Request Service</h2>
                <p className="mt-2 text-sm leading-6 text-white/65">
                  Product not working, damaged, or needs assembly or installation.
                </p>
                <span className="mt-5 inline-flex rounded-2xl bg-[#ff5e79] px-5 py-3 text-sm font-bold">
                  Get it fixed <span className="ml-1 inline-block transition group-hover:translate-x-1">→</span>
                </span>
              </Link>

              <Link
                href="/register-complaint"
                className="soft-card group rounded-3xl bg-white p-6 ring-1 ring-black/5 transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ff5e79]/10 text-2xl">💬</div>
                <h2 className="mt-5 text-2xl font-bold">Register a Complaint</h2>
                <p className="mt-2 text-sm leading-6 text-black/55">
                  Unhappy with billing, delivery, staff or product quality? Tell us.
                </p>
                <span className="mt-5 inline-flex rounded-2xl border border-black/10 px-5 py-3 text-sm font-bold">
                  Tell us <span className="ml-1 inline-block transition group-hover:translate-x-1">→</span>
                </span>
              </Link>
            </div>

            <ul className="mt-6 flex flex-wrap gap-2 text-sm font-semibold text-black/65">
              {[`⏱️ Reply within ${ACK_HOURS} working hours`, "🔧 Most repairs in 2–3 days", "📲 Updates on WhatsApp"].map((item) => (
                <li key={item} className="rounded-full bg-white/80 px-3 py-1.5 ring-1 ring-black/5">
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <div className="soft-card rounded-3xl bg-white p-6 ring-1 ring-black/5 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#11b8d0]">Already raised a request?</p>
              <h2 className="mt-2 text-2xl font-bold">Track it here</h2>
              <HomeTrackForm />
            </div>

            <Link
              href="/my-warranties"
              className="group flex items-center justify-between gap-4 rounded-3xl bg-gradient-to-br from-[#11b8d0] to-[#0b98ad] p-6 text-white shadow-lg shadow-[#11b8d0]/25 transition hover:-translate-y-0.5"
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/75">Warranty</p>
                <h2 className="mt-1 text-xl font-bold">Find my warranty</h2>
                <p className="mt-1 text-sm text-white/85">
                  Registered at billing. Get your certificate with your mobile and bill number.
                </p>
              </div>
              <span className="text-3xl transition group-hover:translate-x-1">🛡️</span>
            </Link>

            <Link
              href="/feedback"
              className="group flex items-center justify-between gap-4 rounded-3xl bg-gradient-to-br from-[#8883d7] to-[#6f69c9] p-6 text-white shadow-lg shadow-[#8883d7]/25 transition hover:-translate-y-0.5"
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/75">Feedback</p>
                <h2 className="mt-1 text-xl font-bold">Rate your experience</h2>
                <p className="mt-1 text-sm text-white/85">
                  Your purchase, a service visit or how we handled a complaint — 1 minute.
                </p>
              </div>
              <span className="text-3xl transition group-hover:translate-x-1">⭐</span>
            </Link>
          </div>
        </section>
        </div>

        <div className="mx-auto w-full max-w-7xl space-y-6 px-5 pb-10 sm:px-8">
          <OffersBanner />
          <InstallAppCard audience="customer" />
        </div>

        {/* How it works */}
        <section className="border-y border-black/5 bg-white">
          <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8">
            <h2 className="text-2xl font-bold">How it works</h2>
            <ol className="mt-6 grid gap-4 md:grid-cols-3">
              {steps.map((step, index) => (
                <li key={step.title} className="relative overflow-hidden rounded-3xl bg-[#f7f9fb] p-6">
                  <span
                    className="absolute inset-x-0 top-0 h-1"
                    style={{ backgroundColor: ["#ff5e79", "#8883d7", "#11b8d0"][index] }}
                    aria-hidden
                  />
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-2xl font-bold text-white"
                    style={{ backgroundColor: ["#ff5e79", "#8883d7", "#11b8d0"][index] }}
                  >
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-lg font-bold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-black/60">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8">
          <h2 className="text-2xl font-bold">Common questions</h2>
          <div className="mt-6 space-y-3">
            {faqs.map((item) => (
              <details key={item.q} className="soft-card group rounded-2xl bg-white p-5 ring-1 ring-black/5 open:ring-[#ff5e79]/30">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold">
                  {item.q}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ff5e79]/10 text-[#ff5e79] transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-6 text-black/60">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
