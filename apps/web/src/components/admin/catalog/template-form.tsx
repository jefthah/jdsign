"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { ArrowRightIcon } from "@/components/account/icons";
import { genericErrorMessage, leaveOnSessionProblem } from "@/lib/api/admin-client";
import type { AdminCategory, AdminTemplate } from "@/lib/api/admin";
import { browserApi, connectionErrorMessage } from "@/lib/api/browser";

import { formatDigits } from "./format";

type Values = {
  title: string;
  categoryId: string;
  summary: string;
  description: string;
  price: string;
  version: string;
  technology: string;
  previewUrl: string;
};

type Field = keyof Values;

const limits: Partial<Record<Field, number>> = { title: 160, summary: 240, description: 20_000, version: 40, technology: 80 };

function initialValues(template?: AdminTemplate): Values {
  return {
    title: template?.title ?? "",
    categoryId: template ? String(template.category.id) : "",
    summary: template?.summary ?? "",
    description: template?.description ?? "",
    price: template ? String(template.price) : "",
    version: template?.version ?? "1.0.0",
    technology: template?.technology ?? "",
    previewUrl: template?.previewUrl ?? "",
  };
}

/**
 * Details of a template. Without `template` it creates a draft and opens its
 * page for the file uploads; with one it saves changes in place.
 */
export function TemplateForm({ categories, template }: { categories: AdminCategory[]; template?: AdminTemplate }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => initialValues(template));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = busy || template?.archived === true;

  function change(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setNotice(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (busy) {
      return;
    }
    setBusy(true);
    setNotice(null);

    const body = {
      categoryId: Number(values.categoryId) || 0,
      title: values.title,
      summary: values.summary,
      description: values.description,
      price: Number(values.price) || 0,
      version: values.version,
      technology: values.technology,
      previewUrl: values.previewUrl.trim() === "" ? null : values.previewUrl,
    };

    try {
      const result = template
        ? await browserApi.PUT("/admin/templates/{id}", { params: { path: { id: template.id } }, body })
        : await browserApi.POST("/admin/templates", { body });
      if (result.data) {
        if (!template) {
          router.push(`/admin/templates/${result.data.id}?dibuat=1`);
          return;
        }
        setErrors({});
        setNotice({ tone: "success", text: "Perubahan tersimpan." });
        router.refresh();
      } else if (!leaveOnSessionProblem(result.response.status, result.error)) {
        setErrors((result.error?.error.fields ?? {}) as Partial<Record<Field, string>>);
        setNotice({ tone: "error", text: result.error?.error.message ?? genericErrorMessage });
        // The notice is announced; move focus to the first field that needs fixing once the
        // fieldset is enabled again.
        requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      }
    } catch {
      setNotice({ tone: "error", text: connectionErrorMessage });
    }
    setBusy(false);
  }

  return (
    <form className="adm-form" onSubmit={submit} noValidate>
      <fieldset className="adm-fieldset" disabled={disabled}>
        <FormField id="title" label="Judul" error={errors.title} count={values.title.length} limit={limits.title}>
          <input
            id="title"
            className="adm-input"
            value={values.title}
            onChange={(event) => change("title", event.target.value)}
            maxLength={limits.title}
            placeholder="Arunika Studio"
            autoFocus={!template}
            aria-invalid={errors.title ? true : undefined}
          />
        </FormField>

        <div className="adm-form-row">
          <FormField id="categoryId" label="Kategori" error={errors.categoryId}>
            <select
              id="categoryId"
              className="adm-input adm-select"
              value={values.categoryId}
              onChange={(event) => change("categoryId", event.target.value)}
              aria-invalid={errors.categoryId ? true : undefined}
            >
              <option value="" disabled>
                Pilih kategori
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField id="price" label="Harga" error={errors.price} hint="Rp10.000 sampai Rp100.000.000">
            <div className="adm-affix">
              <span aria-hidden="true">Rp</span>
              <input
                id="price"
                className="adm-input"
                inputMode="numeric"
                autoComplete="off"
                value={values.price === "" ? "" : formatDigits(Number(values.price))}
                onChange={(event) => change("price", event.target.value.replace(/\D/g, "").slice(0, 9))}
                placeholder="249.000"
                aria-invalid={errors.price ? true : undefined}
              />
            </div>
          </FormField>
        </div>

        <FormField
          id="summary"
          label="Ringkasan"
          hint="Satu kalimat yang tampil di kartu katalog."
          error={errors.summary}
          count={values.summary.length}
          limit={limits.summary}
        >
          <input
            id="summary"
            className="adm-input"
            value={values.summary}
            onChange={(event) => change("summary", event.target.value)}
            maxLength={limits.summary}
            placeholder="Portfolio satu halaman untuk studio kreatif"
            aria-invalid={errors.summary ? true : undefined}
          />
        </FormField>

        <FormField
          id="description"
          label="Deskripsi"
          hint="Minimal 30 karakter. Ditampilkan sebagai teks biasa; baris baru dipertahankan."
          error={errors.description}
          count={values.description.length}
          limit={limits.description}
        >
          <textarea
            id="description"
            className="adm-input adm-textarea"
            value={values.description}
            onChange={(event) => change("description", event.target.value)}
            maxLength={limits.description}
            rows={8}
            placeholder="Apa isi template ini, untuk siapa, dan halaman apa saja yang termasuk."
            aria-invalid={errors.description ? true : undefined}
          />
        </FormField>

        <div className="adm-form-row">
          <FormField id="technology" label="Teknologi" error={errors.technology}>
            <input
              id="technology"
              className="adm-input"
              value={values.technology}
              onChange={(event) => change("technology", event.target.value)}
              maxLength={limits.technology}
              placeholder="Next.js + Tailwind"
              aria-invalid={errors.technology ? true : undefined}
            />
          </FormField>

          <FormField id="version" label="Versi" error={errors.version}>
            <input
              id="version"
              className="adm-input"
              value={values.version}
              onChange={(event) => change("version", event.target.value)}
              maxLength={limits.version}
              placeholder="1.0.0"
              aria-invalid={errors.version ? true : undefined}
            />
          </FormField>
        </div>

        <FormField id="previewUrl" label="Link pratinjau" hint="Opsional. Demo yang bisa dibuka pembeli, diawali https://." error={errors.previewUrl}>
          <input
            id="previewUrl"
            className="adm-input"
            type="url"
            inputMode="url"
            value={values.previewUrl}
            onChange={(event) => change("previewUrl", event.target.value)}
            maxLength={500}
            placeholder="https://arunika.jd-sign.com"
            aria-invalid={errors.previewUrl ? true : undefined}
          />
        </FormField>
      </fieldset>

      <div className="adm-form-footer">
        {notice ? (
          <p className={`adm-notice adm-notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
            {notice.text}
          </p>
        ) : (
          <p className="adm-hint">{template ? "Status tayang tidak berubah saat menyimpan." : "Template disimpan sebagai draft. File diunggah di langkah berikutnya."}</p>
        )}
        <button type="submit" className="acct-button acct-button-dark" disabled={disabled} aria-busy={busy}>
          {busy ? "Menyimpan…" : template ? "Simpan perubahan" : "Buat draft"}
          <span className="acct-button-badge" aria-hidden="true">
            {busy ? <span className="adm-spinner" /> : <ArrowRightIcon size={16} />}
          </span>
        </button>
      </div>
    </form>
  );
}

function FormField({
  id,
  label,
  hint,
  error,
  count,
  limit,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  count?: number;
  limit?: number;
  children: ReactNode;
}) {
  return (
    <div className="adm-field">
      <div className="adm-label-row">
        <label className="adm-label" htmlFor={id}>
          {label}
        </label>
        {limit !== undefined && count !== undefined && count > limit * 0.8 && (
          <span className="adm-count">
            {formatDigits(count)}/{formatDigits(limit)}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p className="adm-field-error">{error}</p>
      ) : (
        hint && <p className="adm-hint">{hint}</p>
      )}
    </div>
  );
}
