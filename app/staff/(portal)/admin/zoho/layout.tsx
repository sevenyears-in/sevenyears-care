import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";

// The Zoho POS connection is managed by the Super Admin only.
export default async function ZohoLayout({ children }: { children: ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (staff.role !== "super_admin") redirect("/staff");
  return <>{children}</>;
}
