import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { CustomerMenu } from "@/components/CustomerMenu";

const NAV_COLOURS = ["#ff5e79", "#8883d7", "#f39237", "#0fa8bf"]; // logo colours (orange & teal a little deeper for readability)

const navLinks = [
  { href: "/my-warranties", label: "My Warranties" },
  { href: "/request-service", label: "Request Service" },
  { href: "/register-complaint", label: "Complaints" },
  { href: "/track-request", label: "Track Request" },
  { href: "/feedback", label: "Feedback" },
];

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-black/5 bg-white/90 backdrop-blur">
      <div className="brand-stripe h-1 w-full" aria-hidden />
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <Link href="/" aria-label="Seven Years Care home" className="shrink-0">
          <Image
            src="/seven-years-logo-2026.png"
            alt="Seven Years"
            width={724}
            height={405}
            className="h-12 w-auto sm:h-16"
            priority
          />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {navLinks.map((link, i) => (
            <Link
              key={link.href}
              href={link.href}
              style={{ "--c": NAV_COLOURS[i % 4] } as CSSProperties}
              className="rounded-full px-4 py-2 text-sm font-semibold text-black/60 transition hover:bg-[color-mix(in_srgb,var(--c)_12%,transparent)] hover:text-[var(--c)]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <CustomerMenu />
      </div>
      {/* Phones and tablets: the same links as a swipeable row. */}
      <nav className="no-scrollbar flex gap-2 overflow-x-auto px-5 pb-3 lg:hidden" aria-label="Main">
        {navLinks.map((link, i) => (
          <Link
            key={link.href}
            href={link.href}
            style={{ "--c": NAV_COLOURS[i % 4] } as CSSProperties}
            className="whitespace-nowrap rounded-full bg-[color-mix(in_srgb,var(--c)_10%,white)] px-4 py-1.5 text-xs font-semibold text-[var(--c)] ring-1 ring-[color-mix(in_srgb,var(--c)_25%,transparent)]"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="no-print mt-auto bg-[#161616] text-white/70">
      <div className="brand-stripe h-1 w-full" aria-hidden />
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-8 md:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="text-lg font-bold text-white">Seven Years Care</p>
          <p className="mt-2 max-w-sm text-sm leading-6 text-white/55">
            Warranty, service and support for everything you bought at Seven Years — the cradle to scribble baby shop.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Link href="/account" className="hover:text-white">My Account</Link>
          <Link href="/my-warranties" className="hover:text-white">My Warranties</Link>
          <Link href="/request-service" className="hover:text-white">Request Service</Link>
          <Link href="/register-complaint" className="hover:text-white">Complaints</Link>
          <Link href="/track-request" className="hover:text-white">Track Request</Link>
          <Link href="/feedback" className="hover:text-white">Give Feedback</Link>
          <Link href="/privacy" className="hover:text-white">Privacy policy</Link>
          <a href="https://sevenyears.in" className="hover:text-white">sevenyears.in ↗</a>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-7xl px-5 py-4 text-xs text-white/40 sm:px-8">
          © {new Date().getFullYear()} Seven Years. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

/** Page wrapper with header, title block and footer. */
export function PageShell({
  eyebrow = "Seven Years Care",
  title,
  intro,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[#f7f9fb] text-[#161616]">
      <SiteHeader />
      <div className="brand-wash border-b border-black/5">
        <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-6 sm:pb-10 sm:pt-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-black/55 ring-1 ring-black/5 transition hover:text-black"
          >
            ← Home
          </Link>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          {intro && <p className="mt-3 max-w-2xl text-sm leading-6 text-black/60 sm:text-base sm:leading-7">{intro}</p>}
        </div>
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-10">{children}</main>
      <SiteFooter />
    </div>
  );
}

const fieldBase =
  "w-full border border-black/10 bg-white px-4 py-3 outline-none transition placeholder:text-black/30 hover:border-black/20 focus:border-[#ff5e79] focus:ring-4 focus:ring-[#ff5e79]/10";

export const inputClass = `${fieldBase} rounded-2xl`;

/** For the number box that sits next to the "+91" prefix. */
export const phoneInputClass = `${fieldBase} rounded-r-2xl`;

export const labelClass = "mb-2 block text-sm font-semibold";

export const cardClass =
  "soft-card rounded-3xl bg-white p-5 ring-1 ring-black/5 sm:p-8";

export const primaryButtonClass =
  "w-full rounded-2xl bg-gradient-to-r from-[#ff5e79] to-[#ff7a8f] px-5 py-4 text-base font-bold text-white shadow-[0_10px_24px_-10px_rgba(255,94,121,0.7)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-10px_rgba(255,94,121,0.75)] active:translate-y-0 disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none";

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700"
    >
      {message}
    </div>
  );
}

const statusColours: Record<string, string> = {
  active: "bg-green-50 text-green-700 ring-green-600/20",
  open: "bg-amber-50 text-amber-700 ring-amber-600/20",
  under_review: "bg-amber-50 text-amber-700 ring-amber-600/20",
  acknowledged: "bg-sky-50 text-sky-700 ring-sky-600/20",
  awaiting_approval: "bg-violet-50 text-violet-700 ring-violet-600/20",
  assigned: "bg-sky-50 text-sky-700 ring-sky-600/20",
  in_progress: "bg-sky-50 text-sky-700 ring-sky-600/20",
  awaiting_parts: "bg-violet-50 text-violet-700 ring-violet-600/20",
  resolved: "bg-green-50 text-green-700 ring-green-600/20",
  closed: "bg-black/5 text-black/60 ring-black/10",
  cancelled: "bg-black/5 text-black/60 ring-black/10",
  expired: "bg-red-50 text-red-700 ring-red-600/20",
  void: "bg-red-50 text-red-700 ring-red-600/20",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
        statusColours[status] ?? "bg-black/5 text-black/60 ring-black/10"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {label}
    </span>
  );
}
