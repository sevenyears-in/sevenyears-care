import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-[#f7f9fb] text-[#161616]">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-5 py-16 text-center">
        <p className="text-sm font-bold text-[#ff5e79]">Page not found</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-4 text-black/60">
          The link may be incorrect or the certificate may no longer be
          available. You can look up your warranties using your mobile number.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/my-warranties"
            className="rounded-2xl bg-[#ff5e79] px-6 py-3 font-bold text-white"
          >
            Find My Warranties
          </Link>
          <Link
            href="/"
            className="rounded-2xl border border-black/10 bg-white px-6 py-3 font-bold"
          >
            Back to Home
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
