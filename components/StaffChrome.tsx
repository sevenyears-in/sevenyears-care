"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertSoundSettings, LiveAlerts, useUnreadCount } from "@/components/LiveAlerts";
import { canSeeComplaints, canSeeService, isAdmin, ROLE_LABELS, type Role } from "@/lib/roles";

type Props = {
  fullName: string;
  userId: string;
  role: Role;
  storeName: string | null;
  unreadAlerts: number;
  explanationsWaiting: number;
};

export function StaffHeader({ fullName, userId, role, storeName, unreadAlerts, explanationsWaiting }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const unread = useUnreadCount(unreadAlerts);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const seesFeedback =
    isAdmin(role) ||
    ["director", "store_manager", "service_head", "hr_head", "hr_executive", "cre", "operations_manager"].includes(role);

  const links = [
    { href: "/staff", label: "Dashboard" },
    ...(canSeeService(role) ? [{ href: "/staff/service", label: "Service Requests" }] : []),
    ...(canSeeComplaints(role) ? [{ href: "/staff/complaints", label: "Complaints" }] : []),
    { href: "/staff/explanations", label: explanationsWaiting > 0 ? `Explanations (${explanationsWaiting})` : "Explanations" },
    ...(seesFeedback ? [{ href: "/staff/feedback", label: "Feedback" }] : []),
    { href: "/staff/register", label: "Register Warranty" },
    { href: "/staff/warranties", label: "Warranties" },
    ...(isAdmin(role)
      ? [
          { href: "/staff/admin/categories", label: "Categories" },
          { href: "/staff/admin/users", label: "Staff Users" },
          { href: "/staff/admin/service-setup", label: "Service Setup" },
        ]
      : []),
    ...(role === "super_admin"
      ? [
          { href: "/staff/admin/notifications", label: "Alerts Setup" },
          { href: "/staff/admin/channels", label: "Complaint Channels" },
          { href: "/staff/admin/zoho", label: "Zoho POS" },
        ]
      : []),
  ];

  const initials =
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";

  const logout = async () => {
    setLoggingOut(true);
    await fetch("/api/staff/logout", { method: "POST" }).catch(() => null);
    router.replace("/staff/login");
    router.refresh();
  };

  return (
    <header className="no-print sticky top-0 z-30 border-b border-black/5 bg-white/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <LiveAlerts />
      <div className="brand-stripe h-1 w-full" aria-hidden />
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6 sm:py-3">
        <Link href="/staff" className="shrink-0">
          <Image
            src="/seven-years-logo-2026.png"
            alt="Seven Years"
            width={724}
            height={405}
            className="h-12 w-auto sm:h-14"
            priority
          />
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/staff/alerts"
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-black/10 text-lg transition hover:bg-[#f7f9fb]"
            aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`}
          >
            <span aria-hidden>🔔</span>
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff5e79] px-1 text-[11px] font-bold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-full border border-black/10 py-1 pl-1 pr-1 transition hover:bg-[#f7f9fb] sm:pr-3"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ff5e79] text-xs font-bold text-white">
                {initials}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block max-w-[160px] truncate text-sm font-bold">{fullName}</span>
                <span className="block text-[11px] text-black/50">{ROLE_LABELS[role]}</span>
              </span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-12 z-40 w-72 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-black/10"
              >
                <div className="border-b border-black/5 px-3 pb-3 pt-2">
                  <p className="font-bold">{fullName}</p>
                  <p className="text-xs text-black/50">
                    {userId} · {ROLE_LABELS[role]}
                  </p>
                  {storeName && <p className="mt-0.5 text-xs text-black/50">{storeName}</p>}
                </div>
                <div className="py-2">
                  <AlertSoundSettings />
                </div>
                <div className="border-t border-black/5 pt-2">
                  <Link
                    href="/staff/password"
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-xl px-3 py-2 text-sm font-semibold hover:bg-[#f7f9fb]"
                  >
                    🔑 Change password
                  </Link>
                  <button
                    type="button"
                    onClick={logout}
                    disabled={loggingOut}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-[#d43852] hover:bg-[#ff5e79]/10 disabled:opacity-50"
                  >
                    {loggingOut ? "Logging out…" : "↩ Log out"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <nav className="no-scrollbar mx-auto hidden max-w-6xl gap-1 overflow-x-auto px-4 pb-2.5 sm:flex sm:px-6">
        {links.map((link) => {
          const active =
            link.href === "/staff" ? pathname === "/staff" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold transition ${
                active ? "bg-[#161616] text-white shadow-sm" : "text-black/55 hover:bg-[#f7f9fb] hover:text-black"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      {/* Phones: the main pages are in the bottom menu; everything else scrolls here. */}
      <nav className="no-scrollbar flex gap-1.5 overflow-x-auto px-3 pb-2.5 sm:hidden" aria-label="More pages">
        {links
          .filter((l) => !["/staff", "/staff/service", "/staff/complaints", "/staff/register"].includes(l.href))
          .map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
                  active ? "bg-[#ff5e79] text-white" : "bg-[#f7f9fb] text-black/60"
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

/** Phone-style menu at the bottom of the screen (phones only). */
export function StaffBottomNav({ role, unreadAlerts }: { role: Role; unreadAlerts: number }) {
  const pathname = usePathname();
  const unread = useUnreadCount(unreadAlerts);
  const items = [
    { href: "/staff", label: "Home", icon: "🏠" },
    ...(canSeeService(role) ? [{ href: "/staff/service", label: "Service", icon: "🛠️" }] : []),
    ...(canSeeComplaints(role) ? [{ href: "/staff/complaints", label: "Complaints", icon: "💬" }] : []),
    { href: "/staff/register", label: "Warranty", icon: "🧾" },
    { href: "/staff/alerts", label: "Alerts", icon: "🔔", badge: unread },
  ];

  return (
    <nav
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 backdrop-blur sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main menu"
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = item.href === "/staff" ? pathname === "/staff" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${
                active ? "text-[#ff5e79]" : "text-black/55"
              }`}
            >
              <span className="text-lg leading-none" aria-hidden>
                {item.icon}
              </span>
              {item.label}
              {"badge" in item && item.badge ? (
                <span className="absolute right-[22%] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff5e79] px-1 text-[10px] font-bold text-white">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
