"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { OverviewIcon, ReceiptIcon } from "@/components/account/icons";

import { LayoutIcon, ListIcon, TagIcon, UsersIcon } from "./icons";

const adminLinks: { href: string; label: string; icon: ReactNode }[] = [
  { href: "/admin", label: "Ringkasan", icon: <OverviewIcon /> },
  { href: "/admin/templates", label: "Template", icon: <LayoutIcon /> },
  { href: "/admin/categories", label: "Kategori", icon: <TagIcon /> },
];

/**
 * Admin screens from docs/spec.md section 14 that are not built yet. Shops and
 * payouts stay out while JD Sign is the only seller.
 */
const upcomingScreens: { label: string; icon: ReactNode }[] = [
  { label: "Pesanan", icon: <ReceiptIcon /> },
  { label: "Pengguna", icon: <UsersIcon /> },
  { label: "Log audit", icon: <ListIcon /> },
];

function isCurrent(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Sidebar of the admin panel; a tab row on phones (see account.css). The
 * pathname is request data on dynamic routes such as /admin/templates/[id], so
 * the layout renders this inside <Suspense> with <AdminNavLinks pathname={null} />.
 */
export function AdminNav() {
  return <AdminNavLinks pathname={usePathname()} />;
}

export function AdminNavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav className="acct-nav" aria-label="Panel admin">
      {adminLinks.map((link) => (
        <Link key={link.href} href={link.href} aria-current={pathname && isCurrent(pathname, link.href) ? "page" : undefined}>
          {link.icon}
          {link.label}
        </Link>
      ))}
      {upcomingScreens.map((screen) => (
        <span key={screen.label} className="adm-nav-soon" aria-disabled="true">
          {screen.icon}
          {screen.label}
          <span className="adm-soon-badge">Segera</span>
        </span>
      ))}
    </nav>
  );
}
