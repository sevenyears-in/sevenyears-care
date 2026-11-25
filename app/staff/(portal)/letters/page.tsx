import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { attendanceCode } from "@/lib/attendance";
import { formatDate, formatDateTime } from "@/lib/helpers";
import {
  canApproveLetters,
  canWriteLetters,
  isLetterKind,
  LETTER_KINDS,
  letterRecipients,
  lettersFor,
  sendsDirectly,
  signatureFor,
  type Letter,
} from "@/lib/warning-letters";
import { LetterSignature, NewLetterForm } from "@/components/WarningLetters";

export const dynamic = "force-dynamic";

// Warning letters: the ones I received, and (Super Admin / HR / Director / Store Manager) the ones I issue or approve.
export default async function WarningLettersPage({ searchParams }: { searchParams: Promise<{ code?: string; kind?: string; m?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");

  const writer = canWriteLetters(staff.role);
  let lists: Awaited<ReturnType<typeof lettersFor>>;
  try {
    lists = await lettersFor(staff);
  } catch {
    lists = { mine: [], toApprove: [], issued: [] };
  }
  const people = writer ? await letterRecipients(staff) : [];
  const sig = writer ? await signatureFor(staff) : null;
  // Opened from a record in Care (e.g. "Warning letter" next to an SOP violation).
  const sp = await searchParams;
  const startPerson = sp.code ? people.find((p) => attendanceCode(p.userId) === attendanceCode(sp.code)) : undefined;
  const start =
    startPerson && isLetterKind(sp.kind) ? { staffId: startPerson.id, kind: sp.kind, month: sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : undefined } : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Warning letters</h1>
        <p className="mt-2 text-sm text-black/60">
          {writer
            ? sendsDirectly(staff.role)
              ? "Issue a formal warning letter to a staff member. They get it in the app, as a phone notification and by e-mail (PDF on the letterhead), and confirm that they have read it."
              : "Write a formal warning letter for a staff member of your store. HR or the Director approves it, then the staff member gets it in the app and by e-mail."
            : "Formal letters from the management. Read each letter and confirm that you have read it."}
        </p>
      </div>

      {sig && <LetterSignature name={sig.name} title={sig.title} imageUrl={sig.imageUrl} />}
      {writer && <NewLetterForm people={people} kinds={LETTER_KINDS} direct={sendsDirectly(staff.role)} start={start} />}

      {lists.mine.length > 0 && <List title="Letters to me" letters={lists.mine} mine />}
      {canApproveLetters(staff.role) && (
        <List title="Waiting for approval" letters={lists.toApprove} empty="Nothing is waiting for your approval." />
      )}
      {writer && (
        <List
          title={canApproveLetters(staff.role) ? "Letters issued" : "Letters I wrote"}
          letters={lists.issued}
          empty="No letters yet."
        />
      )}
      {!writer && lists.mine.length === 0 && (
        <p className="soft-card rounded-3xl bg-white p-5 text-sm text-black/55 ring-1 ring-black/5">You have no letters.</p>
      )}
    </div>
  );
}

function state(l: Letter, mine = false) {
  if (l.status === "pending") return { label: "Waiting for approval", tone: "bg-amber-50 text-amber-800", bar: "bg-amber-400" };
  if (l.status === "rejected") return { label: "Not approved", tone: "bg-black/5 text-black/50", bar: "bg-black/20" };
  if (l.status === "withdrawn") return { label: "Withdrawn", tone: "bg-black/5 text-black/50", bar: "bg-black/20" };
  if (l.status === "revoked") return { label: "Revoked", tone: "bg-black/5 text-black/60", bar: "bg-black/30" };
  if (!l.ack_at && mine) return { label: "Please read & acknowledge", tone: "bg-[#ff5e79]/10 text-[#d63a57]", bar: "bg-[#ff5e79]" };
  if (!l.ack_at && !l.seen_at) return { label: "Not opened yet", tone: "bg-amber-50 text-amber-800", bar: "bg-amber-400" };
  if (!l.ack_at) return { label: "Opened · not acknowledged", tone: "bg-[#ff5e79]/10 text-[#d63a57]", bar: "bg-[#ff5e79]" };
  return { label: "Acknowledged", tone: "bg-green-50 text-green-700", bar: "bg-green-500" };
}

function List({ title, letters, empty, mine = false }: { title: string; letters: Letter[]; empty?: string; mine?: boolean }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold">{title}</h2>
      {letters.length === 0 ? (
        <p className="soft-card rounded-3xl bg-white p-5 text-sm text-black/55 ring-1 ring-black/5">{empty}</p>
      ) : (
        <ul className="soft-card divide-y divide-black/5 overflow-hidden rounded-3xl bg-white ring-1 ring-black/5">
          {letters.map((l) => {
            const s = state(l, mine);
            return (
              <li key={l.id} className="relative">
                <span className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${s.bar}`} aria-hidden />
                <Link href={`/staff/letters/${l.id}`} className="block px-5 py-4 pl-6 hover:bg-[#f7f9fb]">
                  <div className="flex flex-wrap items-center gap-2">
                    {l.number && <span className="font-mono text-xs font-bold text-[#11b8d0]">{l.number}</span>}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${s.tone}`}>{s.label}</span>
                    <span className="text-xs text-black/45">{LETTER_KINDS[l.kind] ?? l.kind}</span>
                  </div>
                  <p className="mt-1.5 text-sm">
                    {!mine && (
                      <>
                        <span className="font-semibold">{l.staff_name}</span>
                        <span className="text-black/50"> ({l.user_id}{l.store ? ` · ${l.store}` : ""}) — </span>
                      </>
                    )}
                    <span className={mine ? "font-semibold" : ""}>{l.subject}</span>
                  </p>
                  <p className="mt-1 text-xs text-black/45">
                    {l.status === "sent" || l.status === "revoked"
                      ? `Issued ${formatDate(l.sent_at)} by ${l.issued_by_name ?? ""}${!mine && l.seen_at ? ` · opened ${formatDateTime(l.seen_at)}` : ""}${l.ack_at ? ` · acknowledged ${formatDateTime(l.ack_at)}` : ""}`
                      : `Written ${formatDate(l.created_at)} by ${l.created_by_name ?? ""}`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
