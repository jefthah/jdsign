import Link from "next/link";
import type { ReactNode } from "react";

import { styles } from "./auth-styles";
import { CheckIcon } from "./icons";

export type AuthVariant = "login" | "register";

const panelCopy = {
  login: {
    title: (
      <>
        Template website untuk ide yang <em>berani.</em>
      </>
    ),
    lead: "Satu akun untuk membeli, mengunduh file sumber, dan menyimpan template favorit Anda.",
    subject: "Kode masuk JD Sign Anda",
    body: "Kode berlaku 10 menit dan hanya bisa dipakai sekali. Jangan bagikan kode ini kepada siapa pun, termasuk tim JD Sign.",
    perks: ["Tanpa kata sandi", "Bayar lewat QRIS", "Unduh ulang kapan saja"],
  },
  register: {
    title: (
      <>
        Satu akun untuk beli, unduh, dan <em>jual template.</em>
      </>
    ),
    lead: "Mulai sebagai pembeli. Saat siap, buka toko sendiri dan terima 90% dari setiap penjualan.",
    subject: "Verifikasi email Anda",
    body: "Masukkan kode ini untuk menyelesaikan pendaftaran. Berlaku 10 menit dan hanya bisa dipakai sekali.",
    perks: ["Gratis mendaftar", "Tanpa kata sandi", "Bisa buka toko kapan saja"],
  },
} as const;

export function Wordmark() {
  return (
    <Link href="/" className={styles.wordmark} aria-label="JD Sign — beranda">
      <span className={styles.wordmarkTile}>JD</span>
      SIGN
    </Link>
  );
}

/** Split layout shared by the sign-in and sign-up pages: form on the left, brand panel on the right. */
export function AuthShell({ variant, children }: { variant: AuthVariant; children: ReactNode }) {
  const isLogin = variant === "login";

  return (
    <div className={styles.page}>
      <div className={styles.pane}>
        <header className={styles.topbar}>
          <Wordmark />
          <div className={styles.switch}>
            <span className={styles.switchPrompt}>{isLogin ? "Belum punya akun?" : "Sudah punya akun?"}</span>
            <Link className={styles.pillLink} href={isLogin ? "/register" : "/login"}>
              {isLogin ? "Daftar" : "Masuk"}
            </Link>
          </div>
        </header>

        <main className={styles.main}>{children}</main>

        <footer className={styles.bottombar}>
          <span>© 2026 JD Sign</span>
          <nav className={styles.bottomLinks} aria-label="Tautan bawah">
            <Link href="/">Beranda</Link>
            <Link href="/#koleksi">Jelajahi template</Link>
            <a href="mailto:hello@jd-sign.com">Bantuan</a>
          </nav>
        </footer>
      </div>

      <BrandPanel variant={variant} />
    </div>
  );
}

function BrandPanel({ variant }: { variant: AuthVariant }) {
  const copy = panelCopy[variant];

  return (
    <aside className={styles.panel} aria-label="Tentang JD Sign">
      <span className={styles.panelGlow} aria-hidden="true" />
      <div className={styles.panelCopy}>
        <span className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          DESAIN INDEPENDEN. IDE TANPA BATAS.
        </span>
        <h2 className={styles.panelTitle}>{copy.title}</h2>
        <p className={styles.panelLead}>{copy.lead}</p>
      </div>

      <div className={styles.preview} aria-hidden="true">
        <span className={styles.toast}>
          <span className={styles.toastCheck}>
            <CheckIcon />
          </span>
          Kode terkirim dalam hitungan detik
        </span>
        <div className={styles.mailCard}>
          <div className={styles.sender}>
            <span className={styles.senderTile}>JD</span>
            <span>
              <span className={styles.senderName}>JD Sign</span>
              <span className={styles.senderMeta}>hello@jd-sign.com · baru saja</span>
            </span>
          </div>
          <p className={styles.subject}>{copy.subject}</p>
          <div className={styles.sampleCode}>
            <span className={styles.sampleDigit} />
            <span className={styles.sampleDigit} />
            <span className={styles.sampleDigit} />
            <span className={styles.sampleSeparator} />
            <span className={styles.sampleDigit} />
            <span className={styles.sampleDigit} />
            <span className={styles.sampleDigit} />
          </div>
          <p className={styles.mailBody}>{copy.body}</p>
        </div>
      </div>

      <ul className={styles.perks}>
        {copy.perks.map((perk) => (
          <li key={perk}>{perk}</li>
        ))}
      </ul>
    </aside>
  );
}
