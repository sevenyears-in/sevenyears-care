"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseReport } from "@/lib/report-parse";
import { ReportBody } from "@/components/ReportBody";
import { recheckAlerts } from "@/components/LiveAlerts";

/** One unread alert: opening it (or ✓) marks it read, so it disappears from the list. */
export function AlertItem({
  id,
  href,
  title,
  body,
  when,
}: {
  id: string;
  href: string;
  title: string;
  body: string | null;
  when: string;
}) {
  const router = useRouter();
  const [gone, setGone] = useState(false);

  const markRead = () =>
    fetch("/api/staff/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      keepalive: true,
    })
      .then(() => recheckAlerts())
      .catch(() => null);

  if (gone) return null;
  const report = parseReport(body);
  return (
    <li className="flex items-start gap-3 px-5 py-4 transition hover:bg-[#f7f9fb]">
      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#ff5e79]" aria-hidden />
      <button
        type="button"
        onClick={async () => {
          setGone(true);
          await markRead();
          router.push(href);
        }}
        className="min-w-0 flex-1 text-left"
      >
        <p className="font-bold">{title}</p>
        {report ? (
          <div className="mt-2">
            <ReportBody segs={report} />
          </div>
        ) : (
          body && <p className="mt-1 whitespace-pre-line text-sm text-black/60">{body}</p>
        )}
        <p className="mt-1 text-xs text-black/40">{when}</p>
      </button>
      <button
        type="button"
        aria-label="Mark as read"
        title="Mark as read"
        onClick={async () => {
          setGone(true);
          await markRead();
          router.refresh();
        }}
        className="shrink-0 rounded-full border border-black/10 px-2.5 py-1 text-xs font-bold text-black/50 hover:bg-black hover:text-white"
      >
        ✓
      </button>
    </li>
  );
}
