import type { ReactNode } from "react";
import type { Metadata } from "next";

// Every /staff page installs as the separate "SY Staff" app.
export const metadata: Metadata = {
  manifest: "/staff-app.webmanifest",
  appleWebApp: { capable: true, title: "SY Staff", statusBarStyle: "default" },
};

export default function StaffLayout({ children }: { children: ReactNode }) {
  return children;
}
