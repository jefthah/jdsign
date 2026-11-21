import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { AccountMenuSkeleton } from "@/components/account/account-menu";
import { ShieldIcon } from "@/components/account/icons";
import { TopbarAccount } from "@/components/account/topbar-account";
import { AdminNav } from "@/components/admin/admin-nav";
import { Wordmark } from "@/components/auth/auth-shell";

import "@/components/admin/admin.css";

/**
 * Shell for the admin panel, built on the account area's layout classes. Each
 * page checks access itself (see requireAdminOverview), so this stays static.
 */
export default function AdminPanelLayout({ children }: { children: ReactNode }) {
  return (
    <div className="acct-page">
      <header className="acct-topbar">
        <div className="acct-topbar-inner">
          <Wordmark />
          <span className="adm-pill">
            <ShieldIcon size={16} />
            <span className="adm-topbar-pill-label">Panel admin</span>
          </span>
          <nav className="acct-topnav" aria-label="Navigasi situs">
            <Link href="/">Lihat situs</Link>
            <Link href="/account">Akun saya</Link>
          </nav>
          <Suspense fallback={<AccountMenuSkeleton />}>
            <TopbarAccount />
          </Suspense>
        </div>
      </header>

      <div className="acct-body">
        <aside className="acct-sidebar">
          <div className="acct-profile adm-panel-card">
            <strong>Panel admin</strong>
            <p>Sesi ini sudah diverifikasi dengan aplikasi authenticator.</p>
          </div>
          <AdminNav />
        </aside>
        <main className="acct-main">{children}</main>
      </div>
    </div>
  );
}
