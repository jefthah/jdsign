import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/account/page-parts";
import { CategoryManager } from "@/components/admin/catalog/category-manager";
import { requireAdminCategories } from "@/lib/api/admin";

export const metadata: Metadata = {
  title: "Kategori — Panel admin JD Sign",
  robots: { index: false, follow: false },
};

export default function AdminCategoriesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Categories />
    </Suspense>
  );
}

async function Categories() {
  const categories = await requireAdminCategories("/admin/categories");

  return (
    <>
      <PageHeader
        eyebrow="PANEL ADMIN"
        title="Kategori"
        lead="Pengelompokan template di katalog. Kategori yang masih dipakai template tidak bisa dihapus."
      />
      <CategoryManager categories={categories} />
    </>
  );
}
