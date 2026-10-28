import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/helpers";
import { MarkAlertsRead } from "@/components/MarkAlertsRead";

export default async function AlertsPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");

  const { data } = await supabaseAdmin
    .from("staff_notifications")
    .select("id, ticket_type, ticket_id, title, body, read_at, created_at")
    .eq("staff_id", staff.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const alerts = data ?? [];
  const unread = alerts.filter((a) => !a.read_at).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Alerts</h1>
          <p className="mt-2 text-sm text-black/60">
            New requests, assignments, approvals and escalations for you. The same alerts go to your e-mail and WhatsApp.
          </p>
        </div>
        {unread > 0 && <MarkAlertsRead />}
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-3xl bg-white p-8 text-center text-sm text-black/55 shadow-sm ring-1 ring-black/5">
          No alerts yet.
        </div>
      ) : (
        <ul className="divide-y divide-black/5 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
          {alerts.map((a) => {
            const href = a.ticket_id
              ? `/staff/${a.ticket_type === "service" ? "service" : "complaints"}/${a.ticket_id}`
              : "/staff";
            return (
              <li key={a.id}>
                <Link href={href} className={`block px-5 py-4 transition hover:bg-[#f7f9fb] ${a.read_at ? "opacity-60" : ""}`}>
                  <div className="flex items-center gap-2">
                    {!a.read_at && <span className="h-2 w-2 rounded-full bg-[#ff5e79]" aria-label="Unread" />}
                    <p className="font-bold">{a.title}</p>
                  </div>
                  {a.body && <p className="mt-1 whitespace-pre-line text-sm text-black/60">{a.body}</p>}
                  <p className="mt-1 text-xs text-black/40">{formatDateTime(a.created_at)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
