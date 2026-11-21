"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { OverviewIcon, ReceiptIcon } from "@/components/account/icons";

import { LayoutIcon, ListIcon, StoreIcon, TagIcon, UsersIcon, WalletIcon } from "./icons";

const adminLinks: { href: string; label: string; icon: ReactNode }[] = [
  { href: "/admin", label: "Ringkasan", icon: <OverviewIcon /> },
];

/** Admin screens from docs/spec.md section 14 that are not built yet. */
const upcomingScreens: { label: string; icon: ReactNode }[] = [
  { label: "Toko", icon: <StoreIcon /> },
  { label: "Template", icon: <LayoutIcon /> },
  { label: "Pesanan", icon: <ReceiptIcon /> },
  { label: "Pencairan", icon: <WalletIcon /> },
  { label: "Pengguna", icon: <UsersIcon /> },
  { label: "Kategori", icon: <TagIcon /> },
  { label: "Log audit", icon: <ListIcon /> },
];

/** Sidebar of the admin panel; a tab row on phones (see account.css). */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="acct-nav" aria-label="Panel admin">
      {adminLinks.map((link) => (
        <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>
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
