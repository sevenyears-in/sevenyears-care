import Image from "next/image";
import Link from "next/link";

const actions = [
  {
    title: "Register Warranty",
    description: "Register and protect your Seven Years purchase.",
    href: "/register-warranty",
    icon: "🛡️",
  },
  {
    title: "My Warranties",
    description: "View registered products and warranty details.",
    href: "#",
    icon: "📄",
  },
  {
    title: "Request Service",
    description: "Raise a service request for a registered product.",
    href: "#",
    icon: "🛠️",
  },
  {
    title: "Register Complaint",
    description: "Report an issue and track resolution.",
    href: "#",
    icon: "💬",
  },
  {
    title: "Track Request",
    description: "Check the status of your service or complaint.",
    href: "#",
    icon: "📍",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f7f9fb] text-[#161616]">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Image
            src="/seven-years-logo.png"
            alt="Seven Years"
            width={180}
            height={70}
            className="h-auto w-[150px] sm:w-[180px]"
            priority
          />

          <button
            type="button"
            className="rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-black hover:text-white"
          >
            Sign in
          </button>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:py-16">
        <div className="flex flex-col justify-center">
          <div className="inline-flex w-fit rounded-full bg-[#ff5e79]/10 px-4 py-2 text-sm font-bold text-[#ff5e79]">
            Seven Years Care
          </div>

          <h1 className="mt-6 max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Warranty and service support made simple.
          </h1>

          <p className="mt-5 max-w-xl text-base leading-7 text-black/60 sm:text-lg">
            Register your products, keep warranty details safely available,
            request service, raise complaints, and track support from one place.
          </p>

          <div className="mt-8 max-w-xl rounded-3xl bg-[#161616] p-6 text-white sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/50">
              Quick Start
            </p>

            <h2 className="mt-3 text-2xl font-bold">
              Bought a new product from Seven Years?
            </h2>

            <p className="mt-3 text-sm leading-6 text-white/60">
              Register the warranty now so your purchase details are ready when
              you need service or support.
            </p>

            <Link
              href="/register-warranty"
              className="mt-6 inline-block w-full rounded-2xl bg-[#ff5e79] px-5 py-4 text-center text-base font-bold text-white transition hover:opacity-90 sm:w-auto"
            >
              Register Warranty
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {actions.map((action, index) => (
            <Link
              key={action.title}
              href={action.href}
              className={`group rounded-3xl border border-black/5 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md ${
                index === 0 ? "sm:col-span-2" : ""
              }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f7f9fb] text-2xl">
                {action.icon}
              </div>

              <h2 className="mt-5 text-xl font-bold">{action.title}</h2>

              <p className="mt-2 text-sm leading-6 text-black/55">
                {action.description}
              </p>

              <div className="mt-5 text-sm font-bold text-[#ff5e79]">
                Continue →
              </div>
            </Link>
          ))}

          <a
            href="#"
            className="sm:col-span-2 rounded-3xl bg-[#11b8d0] p-6 text-white transition hover:opacity-95"
          >
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/70">
              Need Help?
            </p>

            <div className="mt-2 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">WhatsApp Support</h2>
                <p className="mt-2 text-sm leading-6 text-white/80">
                  Connect with the Seven Years Care team for assistance.
                </p>
              </div>

              <div className="text-3xl">💬</div>
            </div>
          </a>
        </div>
      </section>

      <footer className="border-t border-black/5 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs text-black/40 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>Seven Years Care</p>
          <p>Warranty • Service • Complaints • Support</p>
        </div>
      </footer>
    </main>
  );
}