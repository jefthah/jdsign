import type { Metadata } from "next";
import { Suspense } from "react";

import { DownloadIcon } from "@/components/account/icons";
import { BrowseButton, EmptyState, PageHeader, PageSkeleton } from "@/components/account/page-parts";
import { requireAccount } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Unduhan — JD Sign",
};

export default function DownloadsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Downloads />
    </Suspense>
  );
}

async function Downloads() {
  await requireAccount("/account/downloads");

  return (
    <>
      <PageHeader
        eyebrow="AKUN SAYA"
        title="Unduhan"
        lead="File ZIP dari template yang sudah lunas. Anda bisa mengunduhnya ulang kapan saja."
      />
      <section className="acct-card" aria-label="Daftar unduhan">
        <EmptyState
          icon={<DownloadIcon size={28} />}
          title="Belum ada unduhan"
          text="Setelah pembayaran sebuah template lunas, file-nya langsung tersedia di sini."
          action={<BrowseButton />}
        />
      </section>
    </>
  );
}
