import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";

import { ArrowRightIcon } from "@/components/account/icons";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/account/page-parts";
import { formatDateTime, formatRupiah } from "@/components/admin/catalog/format";
import { FileMarkers, StatusBadge, TemplateThumb } from "@/components/admin/catalog/parts";
import { LayoutIcon } from "@/components/admin/icons";
import { requireAdminTemplates, type TemplateFilter } from "@/lib/api/admin";

export const metadata: Metadata = {
  title: "Template — Panel admin JD Sign",
  robots: { index: false, follow: false },
};

const basePath = "/admin/templates";

const filters: { value: TemplateFilter; label: string }[] = [
  { value: "active", label: "Semua" },
  { value: "published", label: "Tayang" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Diarsipkan" },
];

type Query = { status: TemplateFilter; q: string; page: number };
type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseQuery(params: SearchParams): Query {
  const status = first(params.status);
  const page = Number.parseInt(first(params.page), 10);

  return {
    status: filters.some((filter) => filter.value === status) ? (status as TemplateFilter) : "active",
    q: first(params.q).trim().slice(0, 100),
    page: Number.isSafeInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

function hrefFor(query: Query): string {
  const params = new URLSearchParams();
  if (query.status !== "active") {
    params.set("status", query.status);
  }
  if (query.q) {
    params.set("q", query.q);
  }
  if (query.page > 1) {
    params.set("page", String(query.page));
  }
  const search = params.toString();

  return search ? `${basePath}?${search}` : basePath;
}

export default function AdminTemplatesPage(props: PageProps<"/admin/templates">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Templates searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Templates({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = parseQuery(await searchParams);
  const list = await requireAdminTemplates(query, hrefFor(query));
  const lastPage = Math.max(1, Math.ceil(list.total / list.perPage));
  const from = list.total === 0 ? 0 : (list.page - 1) * list.perPage + 1;
  const to = Math.min(list.total, list.page * list.perPage);

  return (
    <>
      <PageHeader
        eyebrow="PANEL ADMIN"
        title="Template"
        lead="Semua template yang Anda jual. Draft hanya terlihat di sini sampai ditayangkan."
        action={
          <Link className="acct-button acct-button-dark" href={`${basePath}/new`}>
            Template baru
            <span className="acct-button-badge">
              <ArrowRightIcon size={16} />
            </span>
          </Link>
        }
      />

      <section className="acct-card" aria-label="Daftar template">
        <div className="adm-toolbar">
          <nav className="adm-tabs" aria-label="Saring status">
            {filters.map((filter) => (
              <Link
                key={filter.value}
                href={hrefFor({ status: filter.value, q: query.q, page: 1 })}
                aria-current={filter.value === query.status ? "page" : undefined}
              >
                {filter.label}
              </Link>
            ))}
          </nav>
          <Form action={basePath} className="adm-search" role="search">
            {query.status !== "active" && <input type="hidden" name="status" value={query.status} />}
            <label className="adm-sr" htmlFor="template-search">
              Cari template
            </label>
            <input
              id="template-search"
              className="adm-input adm-search-input"
              type="search"
              name="q"
              defaultValue={query.q}
              maxLength={100}
              placeholder="Cari judul atau teknologi"
            />
            <button type="submit" className="acct-button acct-button-outline adm-search-button">
              Cari
            </button>
          </Form>
        </div>

        {list.data.length === 0 ? (
          <EmptyList query={query} total={list.total} />
        ) : (
          <>
            <ul className="adm-template-list">
              {list.data.map((template) => (
                <li key={template.id}>
                  <Link className="adm-template-row" href={`${basePath}/${template.id}`}>
                    <TemplateThumb template={template} />
                    <span className="adm-template-main">
                      <strong>{template.title}</strong>
                      <span>
                        {template.category.name} · {template.version}
                      </span>
                    </span>
                    <span className="adm-template-state">
                      <StatusBadge template={template} />
                      <FileMarkers template={template} />
                    </span>
                    <span className="adm-template-price">{formatRupiah(template.price)}</span>
                    <span className="adm-template-date">
                      <span className="adm-sr">Diperbarui </span>
                      {formatDateTime(template.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <nav className="adm-pagination" aria-label="Halaman">
              <span>
                {from}–{to} dari {list.total}
              </span>
              {lastPage > 1 && (
                <span className="adm-pagination-links">
                  {list.page > 1 ? (
                    <Link href={hrefFor({ ...query, page: list.page - 1 })} rel="prev">
                      Sebelumnya
                    </Link>
                  ) : (
                    <span aria-disabled="true">Sebelumnya</span>
                  )}
                  <span>
                    {list.page} / {lastPage}
                  </span>
                  {list.page < lastPage ? (
                    <Link href={hrefFor({ ...query, page: list.page + 1 })} rel="next">
                      Berikutnya
                    </Link>
                  ) : (
                    <span aria-disabled="true">Berikutnya</span>
                  )}
                </span>
              )}
            </nav>
          </>
        )}
      </section>
    </>
  );
}

function EmptyList({ query, total }: { query: Query; total: number }) {
  if (total > 0) {
    return (
      <EmptyState
        icon={<LayoutIcon />}
        title="Halaman ini kosong"
        text="Daftarnya lebih pendek dari nomor halaman ini."
        action={
          <Link className="acct-button acct-button-outline" href={hrefFor({ ...query, page: 1 })}>
            Ke halaman pertama
          </Link>
        }
      />
    );
  }
  if (query.q) {
    return (
      <EmptyState
        icon={<LayoutIcon />}
        title="Tidak ada yang cocok"
        text={`Tidak ada template dengan judul atau teknologi berisi "${query.q}".`}
        action={
          <Link className="acct-button acct-button-outline" href={hrefFor({ ...query, q: "", page: 1 })}>
            Hapus pencarian
          </Link>
        }
      />
    );
  }
  if (query.status === "active") {
    return (
      <EmptyState
        icon={<LayoutIcon />}
        title="Belum ada template"
        text="Buat draft, unggah file ZIP dan sampulnya, lalu tayangkan."
        action={
          <Link className="acct-button acct-button-dark" href={`${basePath}/new`}>
            Template baru
            <span className="acct-button-badge">
              <ArrowRightIcon size={16} />
            </span>
          </Link>
        }
      />
    );
  }

  const label = filters.find((filter) => filter.value === query.status)?.label.toLowerCase();
  return <EmptyState icon={<LayoutIcon />} title={`Tidak ada template ${label}`} text="Template dengan status ini akan muncul di sini." />;
}
