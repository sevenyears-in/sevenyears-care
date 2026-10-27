"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  fullName: string;
  userId: string;
  role: "admin" | "staff";
  storeName: string | null;
};

export function StaffHeader({ fullName, userId, role, storeName }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const links = [
    { href: "/staff", label: "Dashboard" },
    { href: "/staff/register", label: "Register Warranty" },
    { href: "/staff/warranties", label: "Warranties" },
    ...(role === "admin"
      ? [
          { href: "/staff/admin/categories", label: "Categories" },
          { href: "/staff/admin/users", label: "Staff Users" },
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
          <div className="text-right leading-tight">
            <p className="font-bold">{fullName}</p>
            <p className="text-xs text-black/50">
              {userId}
              {role === "admin" ? " • Admin" : ""}
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
