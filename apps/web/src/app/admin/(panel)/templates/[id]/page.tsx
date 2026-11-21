import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/account/page-parts";
import { formatDateTime } from "@/components/admin/catalog/format";
import { StatusBadge } from "@/components/admin/catalog/parts";
import { TemplateActions } from "@/components/admin/catalog/template-actions";
import { TemplateFiles } from "@/components/admin/catalog/template-files";
import { TemplateForm } from "@/components/admin/catalog/template-form";
import { requireAdminCategories, requireAdminTemplate, type AdminTemplate } from "@/lib/api/admin";

export const metadata: Metadata = {
  title: "Template — Panel admin JD Sign",
  robots: { index: false, follow: false },
};

export default function AdminTemplatePage(props: PageProps<"/admin/templates/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TemplateDetail params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function TemplateDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Only plain digits: "12abc" or "1e3" should be a 404, not template 12 or 1000.
  const templateId = /^\d{1,15}$/.test(id) ? Number(id) : 0;
  const path = `/admin/templates/${id}`;
  const [template, categories] = await Promise.all([requireAdminTemplate(templateId, path), requireAdminCategories(path)]);
  const justCreated = query.dibuat === "1";

  return (
    <>
      <Link className="adm-back" href="/admin/templates">
        ← Semua template
      </Link>
      <PageHeader
        eyebrow="TEMPLATE"
        title={template.title}
        lead={
          <span className="adm-lead-meta">
            <StatusBadge template={template} />
            <span>{template.category.name}</span>
            <span>Diperbarui {formatDateTime(template.updatedAt)}</span>
          </span>
        }
        action={<TemplateActions template={template} />}
      />

      {template.archived ? (
        <p className="adm-banner adm-banner-archived" role="status">
          Diarsipkan {template.archivedAt ? formatDateTime(template.archivedAt) : ""}. Template ini tidak tampil di situs dan
          tidak bisa diubah. Pulihkan untuk mengedit atau menayangkannya lagi.
        </p>
      ) : template.status === "published" ? (
        <p className="adm-banner adm-banner-published" role="status">
          Tayang sejak {template.publishedAt ? formatDateTime(template.publishedAt) : "-"}. Perubahan yang Anda simpan langsung
          berlaku di situs.
        </p>
      ) : (
        <Readiness template={template} justCreated={justCreated} />
      )}

      <section className="acct-card" aria-labelledby="template-files">
        <div className="acct-card-head">
          <div>
            <h2 id="template-files">File</h2>
            <p>File ZIP hanya bisa diunduh admin dan pembeli. Mengganti file tidak memengaruhi pembeli lama.</p>
          </div>
        </div>
        <div className="acct-card-body">
          <TemplateFiles template={template} />
        </div>
      </section>

      <section className="acct-card" aria-labelledby="template-details">
        <div className="acct-card-head">
          <div>
            <h2 id="template-details">Detail</h2>
            <p>
              Slug <code className="adm-code">{template.slug}</code> tetap sama meski judul berubah.
            </p>
          </div>
        </div>
        <TemplateForm categories={categories} template={template} />
      </section>
    </>
  );
}

/** What is still missing before the draft can go live. */
function Readiness({ template, justCreated }: { template: AdminTemplate; justCreated: boolean }) {
  const steps = [
    { done: true, title: "Detail tersimpan", text: "Judul, kategori, harga, dan deskripsi." },
    { done: template.zip != null, title: "File ZIP", text: "Yang diunduh pembeli setelah membayar." },
    { done: template.hasCover, title: "Sampul", text: "Gambar di kartu katalog dan halaman detail." },
  ];
  const ready = steps.every((step) => step.done);

  return (
    <section className="acct-card adm-readiness" aria-labelledby="template-readiness">
      <div className="acct-card-head">
        <div>
          <h2 id="template-readiness">{ready ? "Siap ditayangkan" : justCreated ? "Draft dibuat" : "Belum bisa ditayangkan"}</h2>
          <p>
            {ready
              ? "Semua bagian sudah lengkap. Tekan Tayangkan agar template muncul di katalog."
              : "Lengkapi bagian di bawah, lalu tekan Tayangkan."}
          </p>
        </div>
      </div>
      <ul className="acct-check-list adm-readiness-list">
        {steps.map((step) => (
          <li key={step.title}>
            <span className={`acct-check-icon ${step.done ? "acct-check-icon-ok" : ""}`} aria-hidden="true">
              {step.done ? "✓" : ""}
            </span>
            <span>
              <strong>
                {step.title}
                <span className="adm-sr">{step.done ? " — sudah" : " — belum"}</span>
              </strong>
              {step.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
