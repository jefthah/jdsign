import { Suspense } from "react";

import { serverApi } from "@/lib/api/server";

async function CategoryList() {
  const { data, error } = await serverApi
    .GET("/categories")
    .catch(() => ({ data: undefined, error: true }));

  if (error || !data) {
    return (
      <p className="text-sm text-zinc-500">
        Kategori belum bisa dimuat. Pastikan API berjalan.
      </p>
    );
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {data.data.map((category) => (
        <li
          key={category.id}
          className="rounded-full border border-zinc-200 px-4 py-1.5 text-sm dark:border-zinc-800"
        >
          {category.name}
        </li>
      ))}
    </ul>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-24">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-600">
          JD Sign
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Marketplace template website
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Kerangka awal versi Go + PostgreSQL + Next.js. Desain lengkap menyusul
          di tahap 1.
        </p>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-500">Kategori</h2>
        <Suspense
          fallback={<p className="text-sm text-zinc-500">Memuat kategori…</p>}
        >
          <CategoryList />
        </Suspense>
      </section>
    </main>
  );
}
