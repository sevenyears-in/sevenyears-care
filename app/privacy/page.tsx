import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, cardClass } from "@/components/SiteChrome";

export const metadata: Metadata = { title: "Privacy policy" };

const EMAIL = "care@sevenyears.in";

const sections: { title: string; body: React.ReactNode }[] = [
  {
    title: "Who we are",
    body: (
      <p>
        Seven Years Care (care.sevenyears.in and the Seven Years Care app for Android and iPhone) is the warranty,
        service and support service of Seven Years, the baby &amp; kids store. This policy explains what information we
        keep, why, and the choices you have.
      </p>
    ),
  },
  {
    title: "Information we keep",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>Your name, mobile number and address, and the name and mobile number of a gift recipient if you add one.</li>
        <li>Purchase details: store, invoice number and date, product, model and serial number.</li>
        <li>Warranties, service requests, complaints, quotes and feedback you send us, including photos of a product you upload.</li>
        <li>A login cookie on your device so you stay signed in.</li>
        <li>For Seven Years staff only: work account details and attendance punches from the store attendance machines.</li>
      </ul>
    ),
  },
  {
    title: "How we use it",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>To register and verify your warranty and show it to you.</li>
        <li>To handle your service requests and complaints, contact you about them and send updates by SMS, WhatsApp or email.</li>
        <li>To prepare quotes for paid service and record your approval.</li>
        <li>To improve our service using your feedback.</li>
      </ul>
    ),
  },
  {
    title: "Sharing",
    body: (
      <p>
        We do not sell your information or use it for advertising. It is shared only with the Seven Years staff handling
        your request, with a brand or service centre when your product needs their repair, and with the companies that
        host and run this service for us (database, hosting and messaging providers), who may use it only to provide
        that service.
      </p>
    ),
  },
  {
    title: "Photos",
    body: (
      <p>
        Photos you add to a service request are used only to understand the problem. They are deleted automatically
        when the request is closed or cancelled.
      </p>
    ),
  },
  {
    title: "How long we keep it",
    body: (
      <p>
        We keep warranty and service records while the warranty is valid and for as long as needed for accounts and the
        law. You can ask us to delete your account and information at any time — see{" "}
        <Link href="/delete-account" className="font-semibold text-[#0b7f90] underline">
          Delete your account
        </Link>
        .
      </p>
    ),
  },
  {
    title: "Security",
    body: (
      <p>
        Information is sent over an encrypted connection (HTTPS), passwords are stored encrypted, and staff can see only
        what their role needs.
      </p>
    ),
  },
  {
    title: "Contact",
    body: (
      <p>
        Questions or requests about your information: email{" "}
        <a href={`mailto:${EMAIL}`} className="font-semibold text-[#0b7f90] underline">
          {EMAIL}
        </a>{" "}
        or speak to any Seven Years store.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <PageShell eyebrow="Seven Years Care" title="Privacy policy" intro="Last updated 8 November 2026.">
      <div className="space-y-4">
        {sections.map((s) => (
          <section key={s.title} className={cardClass}>
            <h2 className="text-lg font-bold">{s.title}</h2>
            <div className="mt-2 text-sm leading-6 text-black/70">{s.body}</div>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
