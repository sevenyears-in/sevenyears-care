import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { teamScope } from "@/lib/team-access";
import TeamSetup from "@/components/TeamSetup";

// Shifts, targets & transfers: admins and HR for everyone, Store Managers for their own team.
export default async function TeamPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (!(await teamScope(staff)).allowed) redirect("/staff");
  return <TeamSetup />;
}
