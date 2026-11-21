import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ArrowUpRightIcon } from "@/components/account/icons";
import { PageHeader, PageSkeleton } from "@/components/account/page-parts";
import { LayoutIcon, TagIcon } from "@/components/admin/icons";
import { requireAdminOverview } from "@/lib/api/admin";

export const metadata: Metadata = {
  title: "Panel admin — JD Sign",
  robots: { index: false, follow: false },
};

const numbers = new Intl.NumberFormat("id-ID");

export default function AdminOverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const overview = await requireAdminOverview();

  const stats = [
    {
      label: "Template tayang",
      value: numbers.format(overview.publishedTemplates),
      hint: "Terlihat di katalog",
      href: "/admin/templates?status=published",
      waiting: false,
    },
    {
      label: "Draft",
      value: numbers.format(overview.draftTemplates),
      hint: "Belum ditayangkan",
      href: "/admin/templates?status=draft",
      waiting: false,
    },
    {
      label: "Kategori",
      value: numbers.format(overview.categories),
      hint: "Pengelompokan katalog",
      href: "/admin/categories",
      waiting: false,
    },
    {
      label: "Pesanan perlu rekonsiliasi",
      value: numbers.format(overview.ordersInReview),
      hint: "Status pembayaran perlu dicek",
      href: null,
      waiting: overview.ordersInReview > 0,
    },
  ];

  const shortcuts = [
    {
      href: "/admin/templates/new",
      icon: <LayoutIcon />,
      title: "Tambah template",
      text: "Buat draft, unggah ZIP dan sampul, lalu tayangkan.",
    },
    {
      href: "/admin/categories",
      icon: <TagIcon />,
      title: "Kelola kategori",
      text: "Tambah, ubah nama, atau hapus kategori yang kosong.",
    },
  ];

  return (
    <>
      <PageHeader eyebrow="PANEL ADMIN" title="Ringkasan" lead="Template yang Anda jual dan pekerjaan yang menunggu tindakan." />

      <section className="adm-stats" aria-label="Angka utama">
        {stats.map((stat) => {
          const body = (
            <>
              <span className="adm-stat-label">{stat.label}</span>
              <span className="adm-stat-value">{stat.value}</span>
              <span className="adm-stat-hint">{stat.hint}</span>
            </>
          );
          const className = `adm-stat ${stat.waiting ? "adm-stat-attention" : ""}`;

          return stat.href ? (
            <Link key={stat.label} href={stat.href} className={`${className} adm-stat-link`}>
              {body}
            </Link>
          ) : (
            <div key={stat.label} className={className}>
              {body}
            </div>
          );
        })}
      </section>

      <section className="acct-shortcuts adm-shortcuts" aria-label="Pintasan">
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
    </>
  );
}
