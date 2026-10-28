"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { canSeeComplaints, canSeeService, isAdmin, ROLE_LABELS, type Role } from "@/lib/roles";

type Props = {
  fullName: string;
  userId: string;
  role: Role;
  storeName: string | null;
  unreadAlerts: number;
};

export function StaffHeader({ fullName, userId, role, storeName, unreadAlerts }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const links = [
    { href: "/staff", label: "Dashboard" },
    ...(canSeeService(role) ? [{ href: "/staff/service", label: "Service Requests" }] : []),
    ...(canSeeComplaints(role) ? [{ href: "/staff/complaints", label: "Complaints" }] : []),
    { href: "/staff/register", label: "Register Warranty" },
    { href: "/staff/warranties", label: "Warranties" },
    ...(isAdmin(role)
      ? [
          { href: "/staff/admin/categories", label: "Categories" },
          { href: "/staff/admin/users", label: "Staff Users" },
        ]
      : []),
    ...(role === "super_admin"
      ? [
          { href: "/staff/admin/notifications", label: "Alerts Setup" },
          { href: "/staff/admin/zoho", label: "Zoho POS" },
        ]
      : []),
  ];

  const logout = async () => {
    setLoggingOut(true);
    await fetch("/api/staff/logout", { method: "POST" }).catch(() => null);
    router.replace("/staff/login");
    router.refresh();
  };

  return (
    <header className="no-print border-b border-black/5 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/staff">
            <Image
              src="/seven-years-logo.png"
              alt="Seven Years"
              width={150}
              height={58}
              className="h-auto w-[110px] sm:w-[130px]"
              priority
            />
          </Link>
          <span className="rounded-full bg-[#161616] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
            Staff
          </span>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/staff/alerts"
            className="relative rounded-xl border border-black/10 px-3 py-2 text-xs font-bold transition hover:bg-[#f7f9fb]"
            aria-label={`Alerts${unreadAlerts ? `, ${unreadAlerts} unread` : ""}`}
          >
            🔔 Alerts
            {unreadAlerts > 0 && (
              <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff5e79] px-1 text-[11px] font-bold text-white">
                {unreadAlerts > 99 ? "99+" : unreadAlerts}
              </span>
            )}
          </Link>
          <div className="text-right leading-tight">
            <p className="font-bold">{fullName}</p>
            <p className="text-xs text-black/50">
              {userId} • {ROLE_LABELS[role]}
              {storeName ? ` • ${storeName}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="rounded-xl border border-black/10 px-3 py-2 text-xs font-bold transition hover:bg-black hover:text-white disabled:opacity-50"
          >
            {loggingOut ? "..." : "Log out"}
          </button>
        </div>
      </div>

      <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
        {links.map((link) => {
          const active =
            link.href === "/staff" ? pathname === "/staff" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition ${
                active ? "bg-[#ff5e79]/10 text-[#ff5e79]" : "text-black/55 hover:bg-[#f7f9fb] hover:text-black"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
