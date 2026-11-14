// Normal (standard) warranty length. Every product gets its category's normal period (6 months);
// the Store Manager may choose a shorter 3-month normal warranty at registration (with a reason).
// Only the Super Admin can change it afterwards. Extended warranty still starts when the normal one ends.

import type { Role } from "@/lib/roles";

export const SHORT_MONTHS = 3;

/** Who may choose the 3-month normal warranty when registering. */
export const canChooseShortWarranty = (staff: { role: Role }) => staff.role === "store_manager";

/** Whether the 3-month option applies to a category whose normal period is `standardMonths`. */
export const shortAllowedFor = (standardMonths: number) => standardMonths > SHORT_MONTHS;
