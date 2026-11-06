import { redirect } from "next/navigation";
import { after } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { canSeeExtensions } from "@/lib/extended-access";
import { markAlertsRead } from "@/lib/alerts";
import { ExtendedWarrantySection } from "@/components/ExtendedWarrantySection";
import { hasSection } from "@/lib/access";

export const dynamic = "force-dynamic";

// All extended warranty requests (the main Dashboard shows the summary and the to-do list).
export default async function ExtendedWarrantyStaffPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (!hasSection(staff, "extended")) redirect("/staff");
  after(() => markAlertsRead(staff.id, { titleLike: "%extended warranty%" }));
  return <ExtendedWarrantySection staff={staff} full />;
}
