import Link from "next/link";
import type { ReactNode } from "react";

import { TemplatePreview } from "@/components/landing/template-preview";
import { templates, type Template } from "@/components/landing/templates";

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
    perks: ["Tanpa kata sandi", "Bayar lewat QRIS", "Unduh ulang kapan saja"],
  },
  register: {
    title: (
      <>
        Satu akun untuk beli, unduh, dan <em>jual template.</em>
      </>
    ),
    lead: "Mulai sebagai pembeli. Saat siap, buka toko sendiri dan terima 90% dari setiap penjualan.",
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

/** Split layout shared by the sign-in and sign-up pages: form on the left, template showcase on the right. */
export function AuthShell({ variant, children }: { variant: AuthVariant; children: ReactNode }) {
  const isLogin = variant === "login";

  return (
    <div className={styles.page}>
      <div className={styles.pane}>
        <header className={styles.topbar}>
          <Wordmark />
          <p className={styles.switch}>
            <span className={styles.switchPrompt}>{isLogin ? "Belum punya akun?" : "Sudah punya akun?"}</span>
            <Link className={styles.switchLink} href={isLogin ? "/register" : "/login"}>
              {isLogin ? "Daftar" : "Masuk"}
            </Link>
          </p>
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

// Three columns of illustrative previews; each column repeats its cards so the scroll loops seamlessly.
const columns: Template[][] = [
  [templates[0], templates[3], templates[5]],
  [templates[2], templates[4], templates[1]],
  [templates[1], templates[5], templates[0]],
];

function BrandPanel({ variant }: { variant: AuthVariant }) {
  const copy = panelCopy[variant];

  return (
    <aside className={styles.panel} aria-label="Tentang JD Sign">
      <div className={styles.wall} aria-hidden="true">
        {columns.map((column, index) => (
          <div className={styles.wallColumn} key={index}>
            <div className={styles.wallTrack}>
              {[...column, ...column].map((template, position) => (
                <div className={styles.wallCard} key={`${template.id}-${position}`}>
                  <TemplatePreview template={template} />
                  <span className={styles.wallLabel}>
                    {template.name} · {template.categoryLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.panelCopy}>
        <span className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          DESAIN INDEPENDEN. IDE TANPA BATAS.
        </span>
        <h2 className={styles.panelTitle}>{copy.title}</h2>
        <p className={styles.panelLead}>{copy.lead}</p>
        <ul className={styles.perks}>
          {copy.perks.map((perk) => (
            <li key={perk}>
              <span className={styles.perkCheck}>
                <CheckIcon size={12} />
              </span>
              {perk}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
