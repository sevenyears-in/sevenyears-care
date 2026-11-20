// Who sees the stock and category pages (server only): management (all stores, or a director's
// stores) and the Store Manager, ASM and Floor Manager of their own store.

import type { StaffUser } from "@/lib/auth";
import { performanceAccess } from "@/lib/performance-access";
import { hasSection } from "@/lib/access";

export async function merchStores(staff: StaffUser, allStores: string[]): Promise<string[]> {
  // Roles with "Stock & Merchandise" (Roles & Access): every store, a director's stores, or their own.
  if (staff.role === "super_admin" || staff.role === "admin") return allStores;
  if (!hasSection(staff, "stock")) {
    // Store / Assistant Store Managers by incentive group keep their own store.
    const a = await performanceAccess(staff);
    const mine = new Set(a.teamAll ? [] : a.teamStores);
    return a.group === "sm" || a.group === "asm" ? allStores.filter((s) => mine.has(s)) : [];
  }
  if (staff.role === "director" && staff.directorStores.length) {
    const mine = new Set(staff.directorStores.map((s) => s.toUpperCase()));
    return allStores.filter((s) => mine.has(s));
  }
  if (staff.access.allStores) return allStores;
  const own = (staff.storeName ?? "").toUpperCase();
  return allStores.filter((s) => s === own);
}
