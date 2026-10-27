import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

const navLinks = [
  { href: "/my-warranties", label: "My Warranties" },
  { href: "/request-service", label: "Request Service" },
  { href: "/register-complaint", label: "Complaints" },
  { href: "/track-request", label: "Track Request" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-black/5 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link href="/" aria-label="Seven Years Care home">
          <Image
            src="/seven-years-logo.png"
            alt="Seven Years"
            width={180}
            height={70}
            className="h-auto w-[130px] sm:w-[170px]"
            priority
          />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-black/60 transition hover:bg-[#f7f9fb] hover:text-black"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/my-warranties"
          className="rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-black hover:text-white lg:hidden"
        >
          My Warranties
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-black/5 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-6 text-xs text-black/40 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>© {new Date().getFullYear()} Seven Years Care</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/my-warranties" className="hover:text-black">Warranty</Link>
          <Link href="/request-service" className="hover:text-black">Service</Link>
          <Link href="/register-complaint" className="hover:text-black">Complaints</Link>
          <Link href="/track-request" className="hover:text-black">Track</Link>
          <Link href="/staff/login" className="hover:text-black">Staff Login</Link>
        </div>
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
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <div className="mb-8">
          <Link
            href="/"
            className="mb-5 inline-block text-sm font-semibold text-black/50 hover:text-black"
          >
            ← Back to home
          </Link>
          <p className="text-sm font-semibold text-[#ff5e79]">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{title}</h1>
          {intro && (
            <p className="mt-3 text-sm leading-6 text-black/60 sm:text-base">
              {intro}
            </p>
          )}
        </div>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

const fieldBase =
  "w-full border border-black/10 bg-white px-4 py-3 outline-none transition focus:border-[#ff5e79] focus:ring-2 focus:ring-[#ff5e79]/15";

export const inputClass = `${fieldBase} rounded-2xl`;

/** For the number box that sits next to the "+91" prefix. */
export const phoneInputClass = `${fieldBase} rounded-r-2xl`;

export const labelClass = "mb-2 block text-sm font-semibold";

export const cardClass =
  "rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-8";

export const primaryButtonClass =
  "w-full rounded-2xl bg-[#ff5e79] px-5 py-4 text-base font-bold text-white transition hover:opacity-90 disabled:opacity-50";

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
  active: "bg-green-100 text-green-800",
  open: "bg-amber-100 text-amber-800",
  under_review: "bg-amber-100 text-amber-800",
  assigned: "bg-sky-100 text-sky-800",
  in_progress: "bg-sky-100 text-sky-800",
  awaiting_parts: "bg-violet-100 text-violet-800",
  resolved: "bg-green-100 text-green-800",
  closed: "bg-black/10 text-black/70",
  cancelled: "bg-black/10 text-black/70",
  expired: "bg-red-100 text-red-800",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
        statusColours[status] ?? "bg-black/10 text-black/70"
      }`}
    >
      {label}
    </span>
  );
}
