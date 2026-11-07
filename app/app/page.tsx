import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { getCurrentCustomer } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

// Start page of the mobile app: goes to the right place for whoever is logged in.
export default async function AppStart() {
  if (await getCurrentStaff()) redirect("/staff");
  if (await getCurrentCustomer()) redirect("/account");
  redirect("/login");
}
