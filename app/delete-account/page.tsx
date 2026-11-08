import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, cardClass } from "@/components/SiteChrome";

export const metadata: Metadata = { title: "Delete your account" };

const EMAIL = "care@sevenyears.in";
const MAIL = `mailto:${EMAIL}?subject=${encodeURIComponent("Delete my Seven Years Care account")}&body=${encodeURIComponent(
  "Please delete my Seven Years Care account.\n\nRegistered mobile number: \nName: ",
)}`;

export default function DeleteAccountPage() {
  return (
    <PageShell
      eyebrow="Seven Years Care"
      title="Delete your account"
      intro="You can ask us to delete your Seven Years Care account and the information linked to it at any time."
    >
      <div className="space-y-4">
        <section className={cardClass}>
          <h2 className="text-lg font-bold">How to ask</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-black/70">
            <li>
              Email{" "}
              <a href={MAIL} className="font-semibold text-[#0b7f90] underline">
                {EMAIL}
              </a>{" "}
              from any email address, or tell any Seven Years store.
            </li>
            <li>Give your name and the mobile number you log in with.</li>
            <li>We confirm it is you by calling or messaging that mobile number, then delete the account within 30 days.</li>
          </ol>
          <a
            href={MAIL}
            className="mt-4 inline-flex rounded-2xl bg-[#ff5e79] px-5 py-3 text-sm font-bold text-white"
          >
            Email a deletion request
          </a>
        </section>
        <section className={cardClass}>
          <h2 className="text-lg font-bold">What is deleted</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-black/70">
            <li>Your login, your contact details and any photos you uploaded.</li>
            <li>Your service requests, complaints and feedback are deleted or made anonymous.</li>
          </ul>
          <h2 className="mt-4 text-lg font-bold">What we may keep</h2>
          <p className="mt-2 text-sm leading-6 text-black/70">
            The sales invoice itself stays in the store&apos;s accounts as the law requires. After deletion you will no
            longer be able to see or claim the warranty online — keep your invoice to claim it at the store.
          </p>
        </section>
        <p className="text-sm text-black/55">
          See also our{" "}
          <Link href="/privacy" className="font-semibold text-[#0b7f90] underline">
            privacy policy
          </Link>
          .
        </p>
      </div>
    </PageShell>
  );
}
