// Who sees the stock and category pages (server only): management (all stores, or a director's
// stores) and the Store Manager, ASM and Floor Manager of their own store.

import type { StaffUser } from "@/lib/auth";
import { performanceAccess } from "@/lib/performance-access";

export async function merchStores(staff: StaffUser, allStores: string[]): Promise<string[]> {
  const a = await performanceAccess(staff);
  if (a.teamAll) return allStores;
  const own = (staff.storeName ?? "").toUpperCase();
  const mine = new Set(a.teamStores);
  // Floor Managers too, also when ASM and Floor Manager are separate roles.
  if (own && (staff.role === "floor_incharge" || /floor\s*(manager|in\s*charge|incharge)/i.test(staff.access.roleLabel))) mine.add(own);
  return allStores.filter((s) => mine.has(s));
}
