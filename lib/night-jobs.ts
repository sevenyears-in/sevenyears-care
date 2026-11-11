// Background timer started once when the server starts (instrumentation.ts). Server only.
// Every minute it checks whether the night copy of earlier months from Zoho POS is due
// (11:30–11:59 pm India time); the job itself makes sure it runs once at a time.

import { inNightWindow, runNightBackfill } from "@/lib/sales-backfill";

const g = globalThis as unknown as { __syNightJobs?: boolean };

export function startNightJobs() {
  if (g.__syNightJobs) return;
  g.__syNightJobs = true;
  const tick = () => {
    if (!inNightWindow()) return;
    runNightBackfill()
      .then((r) => {
        if (r !== "already running" && r !== "nothing to copy") console.log("Night copy from Zoho:", r);
      })
      .catch((e) => console.error("Night copy error:", e));
  };
  const timer = setInterval(tick, 60_000);
  timer.unref?.();
}
