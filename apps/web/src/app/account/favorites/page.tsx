import type { Metadata } from "next";
import { Suspense } from "react";

import { HeartIcon } from "@/components/account/icons";
import { BrowseButton, EmptyState, PageHeader, PageSkeleton } from "@/components/account/page-parts";
import { requireAccount } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Favorit — JD Sign",
};

export default function FavoritesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Favorites />
    </Suspense>
  );
}

async function Favorites() {
  await requireAccount("/account/favorites");

  return (
    <>
      <PageHeader
        eyebrow="AKUN SAYA"
        title="Favorit"
        lead="Simpan template yang menarik perhatian Anda, lalu bandingkan sebelum membeli."
      />
      <section className="acct-card" aria-label="Template favorit">
        <EmptyState
          icon={<HeartIcon size={28} />}
          title="Belum ada favorit"
          text="Template yang Anda simpan akan terkumpul di sini, jadi mudah ditemukan lagi."
          action={<BrowseButton />}
        />
      </section>
    </>
  );
}
