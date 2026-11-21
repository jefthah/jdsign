import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState, PageHeader, PageSkeleton } from "@/components/account/page-parts";
import { TemplateForm } from "@/components/admin/catalog/template-form";
import { TagIcon } from "@/components/admin/icons";
import { requireAdminCategories } from "@/lib/api/admin";

export const metadata: Metadata = {
  title: "Template baru — Panel admin JD Sign",
  robots: { index: false, follow: false },
};

export default function NewTemplatePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewTemplate />
    </Suspense>
  );
}

async function NewTemplate() {
  const categories = await requireAdminCategories("/admin/templates/new");

  return (
    <>
      <Link className="adm-back" href="/admin/templates">
        ← Semua template
      </Link>
      <PageHeader
        eyebrow="TEMPLATE BARU"
        title="Buat draft"
        lead="Isi detailnya dulu. Setelah draft tersimpan, Anda mengunggah file ZIP dan sampul, lalu menayangkannya."
      />

      <section className="acct-card" aria-label="Detail template">
        {categories.length === 0 ? (
          <EmptyState
            icon={<TagIcon />}
            title="Belum ada kategori"
            text="Setiap template masuk ke satu kategori. Buat kategori dulu, lalu kembali ke sini."
            action={
              <Link className="acct-button acct-button-outline" href="/admin/categories">
                Kelola kategori
              </Link>
            }
          />
        ) : (
          <TemplateForm categories={categories} />
        )}
      </section>
    </>
  );
}
