import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/account/page-parts";
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
      label: "Toko menunggu moderasi",
      value: numbers.format(overview.pendingSellers),
      hint: "Pengajuan toko baru",
      waiting: overview.pendingSellers > 0,
    },
    {
      label: "Template perlu ditinjau",
      value: numbers.format(overview.pendingTemplates),
      hint: "Menunggu disetujui atau ditolak",
      waiting: overview.pendingTemplates > 0,
    },
    {
      label: "Pencairan menunggu transfer",
      value: `Rp ${numbers.format(overview.pendingPayoutAmount)}`,
      hint: `${numbers.format(overview.pendingPayouts)} pengajuan`,
      waiting: overview.pendingPayouts > 0,
    },
    {
      label: "Pesanan perlu rekonsiliasi",
      value: numbers.format(overview.ordersInReview),
      hint: "Status pembayaran perlu dicek",
      waiting: overview.ordersInReview > 0,
    },
  ];

  return (
    <>
      <PageHeader eyebrow="PANEL ADMIN" title="Ringkasan" lead="Pekerjaan yang menunggu tindakan admin JD Sign." />

      <section className="adm-stats" aria-label="Pekerjaan yang menunggu">
        {stats.map((stat) => (
          <div key={stat.label} className={`adm-stat ${stat.waiting ? "adm-stat-attention" : ""}`}>
            <span className="adm-stat-label">{stat.label}</span>
            <span className="adm-stat-value">{stat.value}</span>
            <span className="adm-stat-hint">{stat.hint}</span>
          </div>
        ))}
      </section>

      <section className="acct-card" aria-labelledby="admin-next">
        <div className="acct-card-head">
          <div>
            <h2 id="admin-next">Modul berikutnya</h2>
            <p>
              Moderasi toko dan template, pesanan, pencairan, pengguna, kategori, dan log audit sedang dibangun. Setiap
              modul muncul di menu panel begitu siap.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
