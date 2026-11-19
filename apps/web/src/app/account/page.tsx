import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  DownloadIcon,
  HeartIcon,
  MailIcon,
  ReceiptIcon,
  ShieldIcon,
} from "@/components/account/icons";
import { firstName } from "@/components/account/links";
import { BrowseButton, EmptyState, PageHeader, PageSkeleton } from "@/components/account/page-parts";
import { requireAccount } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Akun — JD Sign",
};

const shortcuts = [
  {
    href: "/account/orders",
    title: "Pesanan",
    text: "Status pembayaran dan rincian setiap pembelian.",
    icon: <ReceiptIcon size={22} />,
  },
  {
    href: "/account/downloads",
    title: "Unduhan",
    text: "File ZIP template yang sudah Anda beli.",
    icon: <DownloadIcon size={22} />,
  },
  {
    href: "/account/favorites",
    title: "Favorit",
    text: "Template yang Anda simpan untuk nanti.",
    icon: <HeartIcon size={22} />,
  },
];

export default function AccountOverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const account = await requireAccount("/account");

  return (
    <>
      <PageHeader
        eyebrow="AKUN SAYA"
        title={`Halo, ${firstName(account.name)}.`}
        lead="Kelola pesanan, unduhan, dan template favorit Anda di satu tempat."
        action={<BrowseButton />}
      />

      <section className="acct-shortcuts" aria-label="Pintasan akun">
        {shortcuts.map((shortcut) => (
          <Link key={shortcut.href} href={shortcut.href} className="acct-shortcut">
            <span className="acct-shortcut-icon">{shortcut.icon}</span>
            <h2>{shortcut.title}</h2>
            <p>{shortcut.text}</p>
            <span className="acct-shortcut-arrow">
              <ArrowUpRightIcon />
            </span>
          </Link>
        ))}
      </section>

      <div className="acct-grid">
        <section className="acct-card" aria-labelledby="recent-orders">
          <div className="acct-card-head">
            <h2 id="recent-orders">Pesanan terbaru</h2>
            <Link href="/account/orders">Lihat semua</Link>
          </div>
          <EmptyState
            icon={<ReceiptIcon size={28} />}
            title="Belum ada pesanan"
            text="Pembelian template sedang kami siapkan. Begitu dibuka, pesanan dan status pembayaran Anda tampil di sini."
            action={<BrowseButton label="Lihat koleksi template" />}
          />
        </section>

        <div className="acct-stack">
          <section className="acct-card" aria-labelledby="account-security">
            <div className="acct-card-head">
              <h2 id="account-security">Keamanan akun</h2>
              <Link href="/account/profile">Kelola</Link>
            </div>
            <div className="acct-card-body">
              <ul className="acct-check-list">
                <li>
                  <span className={`acct-check-icon ${account.emailVerified ? "acct-check-icon-ok" : ""}`}>
                    <MailIcon size={18} />
                  </span>
                  <span>
                    <strong>{account.emailVerified ? "Email terverifikasi" : "Email belum terverifikasi"}</strong>
                    {account.email}
                  </span>
                </li>
                <li>
                  <span className="acct-check-icon acct-check-icon-ok">
                    <ShieldIcon size={18} />
                  </span>
                  <span>
                    <strong>Tanpa kata sandi</strong>
                    Masuk dengan kode sekali pakai atau akun Google.
                  </span>
                </li>
              </ul>
            </div>
          </section>

          <section className="acct-card acct-card-dark" aria-labelledby="account-help">
            <div className="acct-card-body">
              <h2 id="account-help">Butuh bantuan?</h2>
              <p>Pertanyaan soal pembelian, lisensi, atau file template? Tim JD Sign siap membantu.</p>
              <a href="mailto:hello@jd-sign.com">
                hello@jd-sign.com <ArrowRightIcon size={16} />
              </a>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
