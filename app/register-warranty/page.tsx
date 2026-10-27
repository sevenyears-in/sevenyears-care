import { redirect } from "next/navigation";

// Warranty registration is now done by staff (bill fetched from Zoho POS).
export default function RegisterWarrantyRedirect() {
  redirect("/staff/register");
}
