import type { Metadata } from "next";
import { Suspense } from "react";

import { ReceiptIcon } from "@/components/account/icons";
import { BrowseButton, EmptyState, PageHeader, PageSkeleton } from "@/components/account/page-parts";
import { requireAccount } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Pesanan — JD Sign",
};

export default function OrdersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Orders />
    </Suspense>
  );
}

async function Orders() {
  await requireAccount("/account/orders");

  return (
    <>
      <PageHeader
        eyebrow="AKUN SAYA"
        title="Pesanan"
        lead="Pantau status pembayaran dan rincian setiap template yang Anda beli."
      />
      <section className="acct-card" aria-label="Daftar pesanan">
        <EmptyState
          icon={<ReceiptIcon size={28} />}
          title="Belum ada pesanan"
          text="Pembelian template sedang kami siapkan. Begitu dibuka, setiap pesanan beserta status pembayarannya tampil di sini."
          action={<BrowseButton />}
        />
      </section>
    </>
  );
}
