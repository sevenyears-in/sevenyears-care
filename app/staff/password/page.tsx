import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { StaffPasswordForm } from "@/components/StaffPasswordForm";

export const metadata = { title: "Change Password", robots: { index: false, follow: false } };

// Staff: change your own password. First login with a temporary password lands here.
export default async function StaffPasswordPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f9fb] px-4 py-10 text-[#161616]">
      <div className="w-full max-w-md">
        <p className="text-sm font-semibold text-[#ff5e79]">Seven Years Care · {staff.fullName}</p>
        <h1 className="mt-1 text-2xl font-bold">Change your password</h1>
        {staff.mustChangePassword && (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            You are using a temporary password. Please choose your own password to continue.
          </p>
        )}
        <StaffPasswordForm canCancel={!staff.mustChangePassword} />
      </div>
    </main>
  );
}
