import type { ReactNode } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { StaffHeader } from "@/components/StaffChrome";

export const metadata: Metadata = {
  title: "Staff",
  robots: { index: false, follow: false },
};

// Every page inside app/staff/(portal) requires a logged-in staff member.
export default async function StaffPortalLayout({ children }: { children: ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");

  const { count } = await supabaseAdmin
    .from("staff_notifications")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", staff.id)
    .is("read_at", null);

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f9fb] text-[#161616]">
      <StaffHeader
        fullName={staff.fullName}
        userId={staff.userId}
        role={staff.role}
        storeName={staff.storeName}
        unreadAlerts={count ?? 0}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
