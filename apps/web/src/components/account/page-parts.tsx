import Link from "next/link";
import type { ReactNode } from "react";

import "./account.css";
import { ArrowRightIcon } from "./icons";

export function PageHeader({
  eyebrow,
  title,
  lead,
  action,
}: {
  eyebrow: string;
  title: string;
  lead: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="acct-header">
      <div>
        <p className="acct-eyebrow">{eyebrow}</p>
        <h1 className="acct-title">{title}</h1>
        <p className="acct-lead">{lead}</p>
      </div>
      {action}
    </header>
  );
}

export function BrowseButton({ label = "Jelajahi template" }: { label?: string }) {
  return (
    <Link className="acct-button acct-button-dark" href="/#koleksi">
      {label}
      <span className="acct-button-badge">
        <ArrowRightIcon size={16} />
      </span>
    </Link>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="acct-empty">
      <span className="acct-empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="acct-main-skeleton" aria-label="Memuat halaman akun">
      <span className="acct-skeleton" style={{ height: 112, maxWidth: 520 }} />
      <span className="acct-skeleton" style={{ height: 320 }} />
    </div>
  );
}
