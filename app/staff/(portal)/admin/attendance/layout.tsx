import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";

// Attendance setup: Super Admin only.
export default async function AttendanceLayout({ children }: { children: ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "super_admin") redirect("/staff");
  return <>{children}</>;
}
