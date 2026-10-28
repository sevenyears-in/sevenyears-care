import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";

// Admin pages: Super Admin and Admin only.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (!isAdmin(staff.role)) redirect("/staff");
  return <>{children}</>;
}
