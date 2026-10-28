import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { emailConfigured, emailSettings, whatsappConfigured, whatsappSettings } from "@/lib/notify";
import { formatDateTime } from "@/lib/helpers";
import { TestAlertButtons } from "@/components/TestAlertButtons";

// Super Admin: is e-mail / WhatsApp set up, test it, and see what was sent.
export default async function NotificationSettingsPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (staff.role !== "super_admin") redirect("/staff");

  const email = emailSettings();
  const wa = whatsappSettings();
  const cronReady = (process.env.CRON_SECRET?.trim().length ?? 0) >= 16;

  const { data: log } = await supabaseAdmin
    .from("notification_log")
    .select("id, channel, recipient, audience, ticket_number, subject, status, error, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = [
    {
      name: "E-mail alerts",
      ok: emailConfigured(),
      detail: emailConfigured() ? `${email.host}:${email.port} as ${email.from}` : "Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM",
    },
    {
      name: "WhatsApp alerts",
      ok: whatsappConfigured(),
      detail: whatsappConfigured()
        ? `Templates: ${wa.staffTemplate} (staff), ${wa.customerTemplate} (customers), language ${wa.language}`
        : "Add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID",
    },
    {
      name: "Automatic escalation",
      ok: cronReady,
      detail: cronReady
        ? "CRON_SECRET is set. Make sure the 30-minute cron job calls /api/cron/sla?key=…"
        : "Add CRON_SECRET (16+ characters) and a 30-minute cron job",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Alerts Setup</h1>
        <p className="mt-2 text-sm text-black/60">
          Dashboard alerts always work. E-mail and WhatsApp need the settings below (see NOTIFICATIONS-SETUP.md in the
          project folder). Staff receive alerts only if their e-mail / WhatsApp number is filled in under Staff Users.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {rows.map((r) => (
          <div key={r.name} className={`rounded-3xl p-5 shadow-sm ring-1 ${r.ok ? "bg-green-50 ring-green-200" : "bg-amber-50 ring-amber-200"}`}>
            <p className="font-bold">{r.ok ? "✅" : "⚠️"} {r.name}</p>
            <p className="mt-2 break-words text-xs text-black/60">{r.detail}</p>
          </div>
        ))}
      </div>

      <TestAlertButtons hasEmail={Boolean(staff.email)} hasWhatsapp={Boolean(staff.whatsappNumber)} />

      <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
        <p className="px-5 pt-5 text-lg font-bold">Last 50 messages</p>
        {(log ?? []).length === 0 ? (
          <p className="p-5 text-sm text-black/55">Nothing sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-3 w-full min-w-[760px] text-left text-sm">
              <thead className="bg-[#f7f9fb] text-xs uppercase tracking-wider text-black/45">
                <tr>
                  <th className="px-5 py-3">When</th>
                  <th className="px-5 py-3">Channel</th>
                  <th className="px-5 py-3">To</th>
                  <th className="px-5 py-3">Ticket</th>
                  <th className="px-5 py-3">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {(log ?? []).map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-3 text-xs">{formatDateTime(l.created_at)}</td>
                    <td className="px-5 py-3">{l.channel === "email" ? "E-mail" : "WhatsApp"} · {l.audience}</td>
                    <td className="px-5 py-3 text-xs">{l.recipient}</td>
                    <td className="px-5 py-3 font-mono text-xs">{l.ticket_number ?? "—"}</td>
                    <td className="px-5 py-3 text-xs">
                      <span className={l.status === "sent" ? "font-bold text-green-700" : l.status === "failed" ? "font-bold text-red-700" : "text-black/50"}>
                        {l.status}
                      </span>
                      {l.error ? <span className="block text-black/50">{l.error}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
