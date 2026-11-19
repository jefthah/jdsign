import type { ReactNode } from "react";

import type { Account } from "@/lib/api/session";

import { DownloadIcon, HeartIcon, OverviewIcon, ReceiptIcon, UserIcon } from "./icons";

/** The fields the header menu and sidebar need; keeps the rest of the account off the client. */
export type AccountSummary = Pick<Account, "name" | "email" | "role" | "emailVerified">;

export function summarize(account: Account): AccountSummary {
  return { name: account.name, email: account.email, role: account.role, emailVerified: account.emailVerified };
}

export const roleLabels: Record<Account["role"], string> = {
  buyer: "Pembeli",
  seller: "Penjual",
  admin: "Admin",
};

export const accountLinks: { href: string; label: string; icon: ReactNode }[] = [
  { href: "/account", label: "Ringkasan", icon: <OverviewIcon /> },
  { href: "/account/orders", label: "Pesanan", icon: <ReceiptIcon /> },
  { href: "/account/downloads", label: "Unduhan", icon: <DownloadIcon /> },
  { href: "/account/favorites", label: "Favorit", icon: <HeartIcon /> },
  { href: "/account/profile", label: "Profil & keamanan", icon: <UserIcon /> },
];

/** "Budi Santoso" → "BS", "jeftadev" → "J". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toUpperCase() || "JD";
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
