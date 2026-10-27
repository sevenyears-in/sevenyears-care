import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";

// Admin pages: administrators only.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (staff.role !== "admin") redirect("/staff");
  return <>{children}</>;
}
