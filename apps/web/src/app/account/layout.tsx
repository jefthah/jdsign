import Link from "next/link";
import { Suspense } from "react";

import { AccountMenuSkeleton, UserAvatar } from "@/components/account/account-menu";
import { AccountNav } from "@/components/account/account-nav";
import { roleLabels } from "@/components/account/links";
import { TopbarAccount } from "@/components/account/topbar-account";
import { Wordmark } from "@/components/auth/auth-shell";
import { getSignedInAccount } from "@/lib/api/session";

/** Shell for every /account page. Each page checks the session itself (see requireAccount). */
export default function AccountLayout({ children }: LayoutProps<"/account">) {
  return (
    <div className="acct-page">
      <header className="acct-topbar">
        <div className="acct-topbar-inner">
          <Wordmark />
          <nav className="acct-topnav" aria-label="Navigasi situs">
            <Link href="/">Beranda</Link>
            <Link href="/#koleksi">Template</Link>
            <Link href="/#kategori">Kategori</Link>
            <a href="mailto:hello@jd-sign.com">Bantuan</a>
          </nav>
          <Suspense fallback={<AccountMenuSkeleton />}>
            <TopbarAccount />
          </Suspense>
        </div>
      </header>

      <div className="acct-body">
        <aside className="acct-sidebar">
          <Suspense fallback={<span className="acct-skeleton acct-profile" style={{ height: 132 }} />}>
            <SidebarProfile />
          </Suspense>
          <AccountNav />
        </aside>
        <main className="acct-main">{children}</main>
      </div>
    </div>
  );
}

async function SidebarProfile() {
  const account = await getSignedInAccount();
  if (!account) {
    return null;
  }

  return (
    <div className="acct-profile">
      <div className="acct-profile-row">
        <UserAvatar name={account.name} size={44} />
        <div className="acct-profile-who">
          <span className="acct-profile-name">{account.name}</span>
          <span className="acct-profile-email">{account.email}</span>
        </div>
      </div>
      <div className="acct-badges">
        <span className="acct-badge">{roleLabels[account.role]}</span>
        {account.emailVerified && (
          <span className="acct-badge acct-badge-lime">
            <span className="acct-badge-dot" />
            Email terverifikasi
          </span>
        )}
      </div>
    </div>
  );
}
