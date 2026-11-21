import Link from "next/link";
import type { ReactNode } from "react";

import { ShieldIcon } from "@/components/account/icons";
import { Wordmark } from "@/components/auth/auth-shell";
import { styles } from "@/components/auth/auth-styles";

import "./admin.css";

/** Single-column frame for the authenticator setup and code pages. */
export function AdminMfaShell({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.page} adm-mfa-page`}>
      <div className={styles.pane}>
        <header className={styles.topbar}>
          <Wordmark />
          <span className="adm-pill">
            <ShieldIcon size={16} />
            Panel admin
          </span>
        </header>

        <main className={styles.main}>{children}</main>

        <footer className={styles.bottombar}>
          <span>© 2026 JD Sign</span>
          <nav className={styles.bottomLinks} aria-label="Tautan bawah">
            <Link href="/account">Akun saya</Link>
            <Link href="/">Beranda</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}

export function AdminMfaSkeleton() {
  return <span className="adm-skeleton" aria-label="Memuat halaman admin" />;
}
