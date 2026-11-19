"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FocusEvent } from "react";

import "./account.css";
import { ChevronDownIcon, LogoutIcon } from "./icons";
import { accountLinks, initials, roleLabels, type AccountSummary } from "./links";
import { useLogout } from "./use-logout";

export function UserAvatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span className="acct-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/**
 * Avatar button that opens the account panel. "dark" sits on the landing hero,
 * "light" on the account pages.
 */
export function AccountMenu({ account, tone = "light" }: { account: AccountSummary; tone?: "light" | "dark" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { busy, logout } = useLogout();

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function closeWhenFocusLeaves(event: FocusEvent<HTMLDivElement>) {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
    }
  }

  return (
    <div className={`acct-menu acct-menu-${tone}`} ref={rootRef} onBlur={closeWhenFocusLeaves}>
      <button
        ref={triggerRef}
        type="button"
        className="acct-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Menu akun ${account.name}`}
        onClick={() => setOpen(!open)}
      >
        <UserAvatar name={account.name} size={tone === "dark" ? 30 : 34} />
        <span className="acct-trigger-name">{account.name}</span>
        <span className="acct-trigger-chevron">
          <ChevronDownIcon />
        </span>
      </button>

      {open && (
        <div className="acct-panel" id={panelId}>
          <div className="acct-panel-head">
            <UserAvatar name={account.name} size={42} />
            <div className="acct-panel-who">
              <span className="acct-panel-name">{account.name}</span>
              <span className="acct-panel-email">{account.email}</span>
            </div>
            <span className="acct-panel-role">{roleLabels[account.role]}</span>
          </div>
          <nav aria-label="Menu akun">
            {accountLinks.map((link) => (
              <Link key={link.href} href={link.href} className="acct-panel-item" onClick={() => setOpen(false)}>
                {link.icon}
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="acct-panel-sep" />
          <button type="button" className="acct-panel-item" onClick={logout} disabled={busy}>
            <LogoutIcon />
            {busy ? "Keluar…" : "Keluar"}
          </button>
        </div>
      )}
    </div>
  );
}

export function AccountMenuSkeleton({ tone = "light" }: { tone?: "light" | "dark" }) {
  return <span className={`acct-trigger-skeleton acct-trigger-skeleton-${tone}`} aria-hidden="true" />;
}
