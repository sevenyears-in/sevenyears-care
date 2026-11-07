"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AlertSoundSettings, LiveAlerts, useUnreadCount } from "@/components/LiveAlerts";
import { isAdmin, type Role } from "@/lib/roles";
import type { Section } from "@/lib/access";
import { afterLogout } from "@/lib/in-app";

/** Logo colours, used in turn for the menu items. */
export const LOGO_COLOURS = ["#ff5e79", "#8883d7", "#f39237", "#0fa8bf"]; // orange & teal slightly deeper so white text stays readable
const navTone = (i: number) => ({ "--c": LOGO_COLOURS[i % LOGO_COLOURS.length] }) as CSSProperties;

type Props = {
  fullName: string;
  userId: string;
  role: Role;
  roleLabel: string;
  sections: Section[];
  storeName: string | null;
  unreadAlerts: number;
  explanationsWaiting: number;
};

export function StaffHeader({ fullName, userId, role, roleLabel, sections, storeName, unreadAlerts, explanationsWaiting }: Props) {
  const can = (s: Section) => sections.includes(s);
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const unread = useUnreadCount(unreadAlerts);
  const menuRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const close = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [settingsOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  // Roles & Access decides which sections each person sees.
  const links = [
    { href: "/staff", label: "Dashboard" },
    ...(can("service") ? [{ href: "/staff/service", label: "Service Requests" }] : []),
    ...(can("complaints") ? [{ href: "/staff/complaints", label: "Complaints" }] : []),
    ...(can("explanations") || explanationsWaiting > 0
      ? [{ href: "/staff/explanations", label: explanationsWaiting > 0 ? `Explanations (${explanationsWaiting})` : "Explanations" }]
      : []),
    ...(can("feedback") ? [{ href: "/staff/feedback", label: "Feedback" }] : []),
    ...(can("register") ? [{ href: "/staff/register", label: "Register Warranty" }] : []),
    ...(can("warranties") ? [{ href: "/staff/warranties", label: "Warranties" }] : []),
  ];

  // Admin pages live under one "Settings" menu so the top bar stays short.
  const settings = [
    ...(isAdmin(role)
      ? [
          { href: "/staff/admin/users", label: "Staff Users", icon: "👥" },
          { href: "/staff/admin/categories", label: "Warranty Categories", icon: "🗂️" },
          { href: "/staff/admin/service-setup", label: "Service Setup", icon: "🛠️" },
        ]
      : []),
    ...(role === "super_admin"
      ? [
          { href: "/staff/admin/roles", label: "Roles & Access", icon: "🔐" },
          { href: "/staff/admin/attendance", label: "Attendance (eTimeTrackLite)", icon: "🕒" },
          { href: "/staff/admin/notifications", label: "Alerts Setup", icon: "🔔" },
          { href: "/staff/admin/channels", label: "Complaint Channels", icon: "💬" },
          { href: "/staff/admin/zoho", label: "Zoho POS", icon: "🔗" },
          { href: "/staff/admin/extended-warranty", label: "Extended Warranty & Payments", icon: "💳" },
        ]
      : []),
  ];
  const settingsActive = settings.some((l) => pathname.startsWith(l.href));

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
    router.replace(afterLogout("/staff/login"));
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
                <span className="block text-[11px] text-black/50">{roleLabel}</span>
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
                    {userId} · {roleLabel}
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

      <nav className="mx-auto hidden max-w-6xl items-center gap-1 px-4 pb-2.5 sm:flex sm:px-6">
        <div className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {links.map((link, i) => {
          const active =
            link.href === "/staff" ? pathname === "/staff" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              style={navTone(i)}
              className={`whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold transition ${
                active
                  ? "bg-[var(--c)] text-white shadow-sm"
                  : "text-black/55 hover:bg-[color-mix(in_srgb,var(--c)_12%,transparent)] hover:text-[var(--c)]"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
        </div>
        {settings.length > 0 && (
          <div className="relative shrink-0" ref={settingsRef}>
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-expanded={settingsOpen}
              aria-haspopup="menu"
              style={navTone(links.length)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold transition ${
                settingsActive || settingsOpen
                  ? "bg-[var(--c)] text-white shadow-sm"
                  : "text-black/55 hover:bg-[color-mix(in_srgb,var(--c)_12%,transparent)] hover:text-[var(--c)]"
              }`}
            >
              ⚙️ Settings <span className={`text-[10px] transition ${settingsOpen ? "rotate-180" : ""}`}>▼</span>
            </button>
            {settingsOpen && (
              <div role="menu" className="absolute right-0 top-11 z-40 w-60 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-black/10">
                {settings.map((l, i) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setSettingsOpen(false)}
                    style={navTone(i)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                      pathname.startsWith(l.href)
                        ? "bg-[color-mix(in_srgb,var(--c)_14%,transparent)] text-[var(--c)]"
                        : "hover:bg-[color-mix(in_srgb,var(--c)_10%,transparent)] hover:text-[var(--c)]"
                    }`}
                  >
                    <span aria-hidden>{l.icon}</span>
                    {l.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>
      {/* Phones: the main pages are in the bottom menu; everything else scrolls here. */}
      <nav className="no-scrollbar flex gap-1.5 overflow-x-auto px-3 pb-2.5 sm:hidden" aria-label="More pages">
        {[...links, ...settings]
          .filter((l) => !["/staff", "/staff/service", "/staff/complaints", "/staff/register"].includes(l.href))
          .map((link, i) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                style={navTone(i)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
                  active ? "bg-[var(--c)] text-white" : "bg-[#f7f9fb] text-black/60"
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
export function StaffBottomNav({ sections, unreadAlerts }: { sections: Section[]; unreadAlerts: number }) {
  const pathname = usePathname();
  const unread = useUnreadCount(unreadAlerts);
  const items = [
    { href: "/staff", label: "Home", icon: "🏠" },
    ...(sections.includes("service") ? [{ href: "/staff/service", label: "Service", icon: "🛠️" }] : []),
    ...(sections.includes("complaints") ? [{ href: "/staff/complaints", label: "Complaints", icon: "💬" }] : []),
    ...(sections.includes("register")
      ? [{ href: "/staff/register", label: "Warranty", icon: "🧾" }]
      : sections.includes("warranties")
        ? [{ href: "/staff/warranties", label: "Warranty", icon: "🧾" }]
        : []),
    { href: "/staff/alerts", label: "Alerts", icon: "🔔", badge: unread },
  ];

  return (
    <nav
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 backdrop-blur sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main menu"
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item, i) => {
          const active = item.href === "/staff" ? pathname === "/staff" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={navTone(i)}
              className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${
                active ? "text-[var(--c)]" : "text-black/55"
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
