// Month pace for a store, counting only finished days: before closing time, today is still
// open — its sales so far are not a full day, and it is still one of the days left to sell.

import type { StoreReport } from "@/lib/performance";

type PaceInput = Pick<StoreReport, "net" | "target" | "daysInMonth" | "daysGone" | "daysDone" | "today">;

export function storePace(s: PaceInput) {
  const done = s.daysDone ?? s.daysGone;
  const todayOpen = done < s.daysGone;
  const doneNet = s.net - (todayOpen ? s.today.net : 0);
  const perDay = done > 0 ? doneNet / done : 0;
  /** Days still to sell, today included while the store is open. */
  const daysLeft = Math.max(0, s.daysInMonth - done);
  const running = daysLeft > 0;
  const neededPerDay = running && s.target > s.net ? (s.target - s.net) / daysLeft : 0;
  const projected = done > 0 ? perDay * s.daysInMonth : s.net;
  return { done, todayOpen, perDay, daysLeft, running, neededPerDay, projected, doneNet };
}
