import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { explanationsForStaff } from "@/lib/explanations";
import { ExplanationsPanel } from "@/components/ExplanationsPanel";

// Every staff member: explanations asked from me (complaints about my sales, delays, SOP issues).
export default async function MyExplanationsPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");

  const all = await explanationsForStaff(staff.id);
  const pending = all.filter((e) => !e.explainedAt);
  const done = all.filter((e) => e.explainedAt);

  const group = (list: typeof all) => {
    const map = new Map<string, typeof all>();
    for (const e of list) {
      const key = `${e.ticketType}:${e.ticketId}`;
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.values()];
  };

  const section = (title: string, list: typeof all, empty: string) => (
    <section className="space-y-3">
      <h2 className="text-xl font-bold">{title}</h2>
      {list.length === 0 ? (
        <p className="rounded-3xl bg-white p-5 text-sm text-black/55 shadow-sm ring-1 ring-black/5">{empty}</p>
      ) : (
        group(list).map((items) => {
          const first = items[0];
          const href = `/staff/${first.ticketType === "service" ? "service" : "complaints"}/${first.ticketId}`;
          return (
            <div key={`${first.ticketType}:${first.ticketId}`} className="space-y-2">
              <Link href={href} className="font-mono text-sm font-bold text-[#11b8d0] hover:underline">
                {first.ticketNumber} — open the {first.ticketType === "service" ? "service request" : "complaint"} →
              </Link>
              <ExplanationsPanel
                type={first.ticketType}
                ticketId={first.ticketId}
                currentStaffId={staff.id}
                canAsk={false}
                explanations={items}
                people={[]}
                suggestedStaffId={null}
              />
            </div>
          );
        })
      )}
    </section>
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">My Explanations</h1>
        <p className="mt-2 text-sm text-black/60">
          When a customer complains about a sale you made, or a manager or Director asks about a delay, you are asked to
          give your side here. Only staff can see your reply.
        </p>
      </div>
      {section("Waiting for your reply", pending, "Nothing is waiting for you. 🎉")}
      {section("Already replied", done, "None yet.")}
    </div>
  );
}
