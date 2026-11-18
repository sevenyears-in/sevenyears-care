import { redirect } from "next/navigation";

// Moved: Store Managers and HR use it too.
export default function OldShiftsPage() {
  redirect("/staff/team");
}
