import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { markAlertsRead } from "@/lib/alerts";
import { formatDate, formatDateTime } from "@/lib/helpers";
import { canApproveLetters, canSeeLetter, getLetter, LETTER_KINDS, letterStores } from "@/lib/warning-letters";
import { LetterActions } from "@/components/WarningLetters";

export const dynamic = "force-dynamic";

export default async function WarningLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  const { id } = await params;
  const l = await getLetter(id).catch(() => null);
  if (!l || !canSeeLetter(staff, l)) notFound();
  after(() => markAlertsRead(staff.id, { ticketId: l.id }));

  const mine = l.staff_id === staff.id;
  const stores = letterStores(staff);
  const approver = canApproveLetters(staff.role) && (stores === null || (!!l.store && stores.includes(l.store.toUpperCase())));
  const draft = l.status !== "sent";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/staff/letters" className="text-sm font-semibold text-[#11b8d0] hover:underline">
          ← Warning letters
        </Link>
        <a
          href={`/api/staff/letters/${l.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-[#161616] px-5 py-2.5 text-sm font-bold text-white"
        >
          {draft ? "Preview PDF" : "Download PDF"}
        </a>
      </div>

      {l.status === "pending" && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Written by {l.created_by_name} ({l.created_by_role}) on {formatDateTime(l.created_at)} — waiting for HR / Director approval. The staff member has not received it.
        </p>
      )}
      {l.status === "rejected" && (
        <p className="rounded-2xl bg-black/5 px-4 py-3 text-sm text-black/70">
          <span className="font-semibold">Not approved</span> by {l.decided_by_name} on {formatDateTime(l.decided_at)}: {l.reject_reason}
        </p>
      )}
      {l.status === "withdrawn" && (
        <p className="rounded-2xl bg-black/5 px-4 py-3 text-sm text-black/70">Withdrawn by {l.decided_by_name} on {formatDateTime(l.decided_at)}. It was not sent.</p>
      )}

      {/* The letter */}
      <article className="soft-card mx-auto max-w-3xl rounded-3xl bg-white p-6 ring-1 ring-black/5 sm:p-10">
        <div className="flex flex-wrap justify-between gap-2 text-xs text-black/50">
          <span>Ref: {l.number ?? "DRAFT"}</span>
          <span>Date: {formatDate(l.sent_at ?? l.created_at)}</span>
        </div>
        <h1 className="mt-5 text-center text-xl font-bold tracking-wide text-[#ff5e79]">WARNING LETTER</h1>
        <div className="mt-5 text-sm">
          <p>To,</p>
          <p className="font-bold">{l.staff_name}</p>
          <p className="text-black/55">Employee code: {l.user_id}</p>
          {l.designation && <p className="text-black/55">Designation: {l.designation}</p>}
          {l.store && <p className="text-black/55">Store: {l.store}</p>}
        </div>
        <p className="mt-5 text-sm font-bold">Subject: {l.subject}</p>
        <div className="mt-4 whitespace-pre-line text-sm leading-relaxed">{l.body}</div>
        <div className="mt-8 text-sm">
          <p>For Seven Years,</p>
          <p className="mt-6 font-bold">{l.issued_by_name ?? l.created_by_name}</p>
          <p className="text-black/55">{l.issued_by_role ?? l.created_by_role}</p>
        </div>
        <p className="mt-6 border-t border-black/5 pt-3 text-xs text-black/45">
          {LETTER_KINDS[l.kind] ?? l.kind}
          {l.decided_by_name && l.status === "sent" ? ` · approved by ${l.decided_by_name}` : ""}
        </p>
      </article>

      {l.status === "sent" && (
        <div className="mx-auto max-w-3xl space-y-2 text-sm">
          {l.ack_at ? (
            <div className="rounded-2xl bg-green-50 px-4 py-3 text-green-800">
              <p className="font-semibold">
                {mine ? "You acknowledged" : `${l.staff_name} acknowledged`} this letter on {formatDateTime(l.ack_at)}.
              </p>
              {l.ack_note && <p className="mt-1 whitespace-pre-line text-green-900">Reply: {l.ack_note}</p>}
            </div>
          ) : (
            !mine && <p className="rounded-2xl bg-[#ff5e79]/10 px-4 py-3 font-semibold text-[#d63a57]">Not acknowledged yet.</p>
          )}
          {!mine && (
            <p className="text-xs text-black/45">
              Sent {formatDateTime(l.sent_at)} · in the app and phone notification · e-mail: {l.email_status ?? "—"}
            </p>
          )}
        </div>
      )}

      <div className="mx-auto max-w-3xl">
        <LetterActions
          id={l.id}
          canAck={mine && l.status === "sent" && !l.ack_at}
          canApprove={approver && l.status === "pending" && !mine}
          canWithdraw={l.status === "pending" && (l.created_by === staff.id || staff.role === "super_admin")}
          subject={l.subject}
          body={l.body}
        />
      </div>
    </div>
  );
}
