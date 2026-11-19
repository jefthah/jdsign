"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import "./account.css";
import { LogoutIcon } from "./icons";
import { accountLinks } from "./links";
import { useLogout } from "./use-logout";

/** Sidebar links on wide screens, a scrollable tab row on phones. */
export function AccountNav() {
  const pathname = usePathname();
  const { busy, logout } = useLogout();

  return (
    <nav className="acct-nav" aria-label="Area akun">
      {accountLinks.map((link) => (
        <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>
          {link.icon}
          {link.label}
        </Link>
      ))}
      <button type="button" className="acct-nav-logout" onClick={logout} disabled={busy}>
        <LogoutIcon />
        {busy ? "Keluar…" : "Keluar"}
      </button>
    </nav>
  );
}

/** Ends the session from the profile page. */
export function LogoutButton() {
  const { busy, logout } = useLogout();

  return (
    <button type="button" className="acct-button acct-button-outline" onClick={logout} disabled={busy}>
      <LogoutIcon />
      {busy ? "Keluar…" : "Keluar dari perangkat ini"}
    </button>
  );
}
