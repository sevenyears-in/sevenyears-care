import type { ReactNode } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { StaffBottomNav, StaffHeader } from "@/components/StaffChrome";
import { AppSetup } from "@/components/InstallApp";
import { pendingExplanationCount } from "@/lib/explanations";
import { performanceAccess, performanceMenuLabel } from "@/lib/performance-access";

export const metadata: Metadata = {
  title: "Staff",
  robots: { index: false, follow: false },
};

// Every page inside app/staff/(portal) requires a logged-in staff member.
export default async function StaffPortalLayout({ children }: { children: ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (staff.mustChangePassword) redirect("/staff/password");

  const [{ count }, explanationsWaiting, perf] = await Promise.all([
    supabaseAdmin
      .from("staff_notifications")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staff.id)
      .is("read_at", null),
    pendingExplanationCount(staff.id).catch(() => 0),
    performanceAccess(staff).catch(() => null),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f9fb] text-[#161616]">
      <StaffHeader
        fullName={staff.fullName}
        userId={staff.userId}
        role={staff.role}
        roleLabel={staff.access.roleLabel}
        sections={staff.access.sections}
        storeName={staff.storeName}
        unreadAlerts={count ?? 0}
        explanationsWaiting={explanationsWaiting}
        performanceLabel={perf ? performanceMenuLabel(perf) : null}
      />
      <AppSetup />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 sm:px-6 sm:py-8">{children}</main>
      <StaffBottomNav sections={staff.access.sections} unreadAlerts={count ?? 0} />
    </div>
  );
}
