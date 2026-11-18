import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Wordmark } from "@/components/auth/auth-shell";
import { styles } from "@/components/auth/auth-styles";
import { LogoutButton } from "@/components/auth/logout-button";
import { getSignedInAccount } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Akun — JD Sign",
};

const roleLabels = { buyer: "Pembeli", seller: "Penjual", admin: "Admin" } as const;

export default function AccountPage() {
  return (
    <div className={styles.accountPage}>
      <header className={styles.topbar}>
        <Wordmark />
        <Suspense fallback={null}>
          <SignedInActions />
        </Suspense>
      </header>
      <main className={styles.accountMain}>
        <Suspense fallback={<div className={styles.skeleton} aria-label="Memuat akun" />}>
          <AccountDetails />
        </Suspense>
      </main>
    </div>
  );
}

async function SignedInActions() {
  return (await getSignedInAccount()) ? <LogoutButton /> : null;
}

async function AccountDetails() {
  const account = await getSignedInAccount();
  if (!account) {
    redirect("/login?next=/account");
  }

  return (
    <div className={styles.column}>
      <div className={styles.heading}>
        <p className={styles.eyebrow}>AKUN ANDA</p>
        <h1 className={styles.title}>Halo, {account.name}.</h1>
        <p className={styles.lead}>
          Anda masuk sebagai <strong>{account.email}</strong>. Riwayat pesanan dan unduhan akan muncul di sini
          setelah pembelian template dibuka.
        </p>
      </div>
      <dl className={styles.accountFacts}>
        <div>
          <dt>Peran</dt>
          <dd>{roleLabels[account.role]}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{account.email}</dd>
        </div>
        <div>
          <dt>Status email</dt>
          <dd>
            <span className={styles.statusPill}>{account.emailVerified ? "Terverifikasi" : "Belum terverifikasi"}</span>
          </dd>
        </div>
      </dl>
      <Link className={styles.primary} href="/#koleksi">
        <span>Jelajahi template</span>
        <span className={styles.arrowBadge} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12h16m-6-6 6 6-6 6" />
          </svg>
        </span>
      </Link>
    </div>
  );
}
