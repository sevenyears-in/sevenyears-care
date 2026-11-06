import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";

// Roles & Access: Super Admin only.
export default async function RolesLayout({ children }: { children: ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "super_admin") redirect("/staff");
  return <>{children}</>;
}
