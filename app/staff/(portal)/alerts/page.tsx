import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/helpers";
import { MarkAlertsRead } from "@/components/MarkAlertsRead";
import { AlertItem } from "@/components/AlertItem";

export default async function AlertsPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");

  const { data } = await supabaseAdmin
    .from("staff_notifications")
    .select("id, ticket_type, ticket_id, title, body, read_at, created_at")
    .eq("staff_id", staff.id)
    .is("read_at", null) // read alerts disappear
    .order("created_at", { ascending: false })
    .limit(100);

  const alerts = data ?? [];
  const unread = alerts.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Alerts</h1>
          <p className="mt-2 text-sm text-black/60">
            New requests, assignments, approvals and escalations for you. Open an alert (or tap ✓) and it disappears. The
            same alerts go to your e-mail and WhatsApp.
          </p>
        </div>
        {unread > 0 && <MarkAlertsRead />}
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-3xl bg-white p-8 text-center text-sm text-black/55 soft-card ring-1 ring-black/5">
          You&apos;re all caught up — no new alerts. 🎉
        </div>
      ) : (
        <ul className="divide-y divide-black/5 overflow-hidden rounded-3xl bg-white soft-card ring-1 ring-black/5">
          {alerts.map((a) => {
            const href = /explanation is needed/i.test(a.title)
              ? "/staff/explanations"
              : /extended warranty/i.test(a.title)
                ? "/staff/extended-warranty"
              : a.ticket_id
              ? `/staff/${a.ticket_type === "service" ? "service" : "complaints"}/${a.ticket_id}`
              : /feedback/i.test(a.title)
                ? "/staff/feedback"
                : "/staff";
            return (
              <AlertItem
                key={a.id}
                id={String(a.id)}
                href={href}
                title={a.title}
                body={a.body}
                when={formatDateTime(a.created_at)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
