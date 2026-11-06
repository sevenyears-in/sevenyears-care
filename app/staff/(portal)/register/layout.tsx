import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { hasSection } from "@/lib/access";

// Roles & Access: only people with the "register" section can open this page.
export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (!hasSection(staff, "register")) redirect("/staff");
  return children;
}
