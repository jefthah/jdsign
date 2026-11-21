"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { genericErrorMessage, leaveOnSessionProblem } from "@/lib/api/admin-client";
import type { AdminCategory } from "@/lib/api/admin";
import { browserApi, connectionErrorMessage, type ApiError } from "@/lib/api/browser";

type Values = { name: string; slug: string; description: string };
type Errors = Partial<Record<keyof Values, string>> & { form?: string };

const empty: Values = { name: "", slug: "", description: "" };

function errorsFrom(failure: ApiError | undefined): Errors {
  const fields = (failure?.error.fields ?? {}) as Errors;
  return Object.keys(fields).length > 0 ? fields : { form: failure?.error.message ?? genericErrorMessage };
}

function bodyOf(values: Values) {
  return { name: values.name, slug: values.slug.trim() || undefined, description: values.description.trim() || null };
}

/** Add, rename, and delete categories. A category still holding templates cannot be deleted. */
export function CategoryManager({ categories }: { categories: AdminCategory[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(empty);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const result = await browserApi.POST("/admin/categories", { body: bodyOf(values) });
      if (result.data) {
        setValues(empty);
        router.refresh();
      } else if (!leaveOnSessionProblem(result.response.status, result.error)) {
        setErrors(errorsFrom(result.error));
      }
    } catch {
      setErrors({ form: connectionErrorMessage });
    }
    setBusy(false);
  }

  return (
    <>
      <section className="acct-card" aria-labelledby="category-new">
        <div className="acct-card-head">
          <div>
            <h2 id="category-new">Kategori baru</h2>
            <p>Slug dipakai di alamat katalog, misalnya landing-page. Kosongkan agar dibuat dari nama.</p>
          </div>
        </div>
        <form className="adm-inline-form" onSubmit={create} noValidate>
          <CategoryFields values={values} errors={errors} onChange={(next) => { setValues(next); setErrors({}); }} idPrefix="new" />
          <div className="adm-inline-actions">
            {errors.form && (
              <p className="adm-field-error" role="alert">
                {errors.form}
              </p>
            )}
            <button type="submit" className="acct-button acct-button-dark adm-action" disabled={busy}>
              {busy ? "Menambahkan…" : "Tambah kategori"}
            </button>
          </div>
        </form>
      </section>

      <section className="acct-card" aria-labelledby="category-list">
        <div className="acct-card-head">
          <div>
            <h2 id="category-list">Semua kategori</h2>
            <p>{categories.length} kategori, urut nama.</p>
          </div>
        </div>
        <ul className="adm-category-list">
          {categories.map((category) =>
            editing === category.id ? (
              <CategoryEditor key={category.id} category={category} onDone={() => setEditing(null)} />
            ) : (
              <CategoryRow key={category.id} category={category} onEdit={() => setEditing(category.id)} />
            ),
          )}
        </ul>
      </section>
    </>
  );
}

function CategoryRow({ category, onEdit }: { category: AdminCategory; onEdit: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inUse = category.templateCount > 0;

  async function remove() {
    if (busy || !window.confirm(`Hapus kategori "${category.name}"?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await browserApi.DELETE("/admin/categories/{id}", { params: { path: { id: category.id } } });
      if (result.response.ok) {
        router.refresh();
        return;
      }
      if (!leaveOnSessionProblem(result.response.status, result.error)) {
        setError(result.error?.error.message ?? genericErrorMessage);
      }
    } catch {
      setError(connectionErrorMessage);
    }
    setBusy(false);
  }

  return (
    <li className="adm-category">
      <div className="adm-category-main">
        <strong>{category.name}</strong>
        <code>{category.slug}</code>
        {category.description && <p>{category.description}</p>}
        {error && (
          <p className="adm-field-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <span className="adm-category-count">{category.templateCount} template</span>
      <div className="adm-category-actions">
        <button type="button" className="adm-text-button" onClick={onEdit}>
          Ubah
        </button>
        <button
          type="button"
          className="adm-text-button adm-text-danger"
          onClick={remove}
          disabled={busy || inUse}
          title={inUse ? "Masih dipakai template; pindahkan templatenya dulu" : undefined}
        >
          {busy ? "Menghapus…" : "Hapus"}
        </button>
      </div>
    </li>
  );
}

function CategoryEditor({ category, onDone }: { category: AdminCategory; onDone: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>({ name: category.name, slug: category.slug, description: category.description ?? "" });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const result = await browserApi.PUT("/admin/categories/{id}", { params: { path: { id: category.id } }, body: bodyOf(values) });
      if (result.data) {
        onDone();
        router.refresh();
        return;
      }
      if (!leaveOnSessionProblem(result.response.status, result.error)) {
        setErrors(errorsFrom(result.error));
      }
    } catch {
      setErrors({ form: connectionErrorMessage });
    }
    setBusy(false);
  }

  return (
    <li className="adm-category adm-category-editing">
      <form className="adm-inline-form" onSubmit={save} noValidate>
        <CategoryFields values={values} errors={errors} onChange={(next) => { setValues(next); setErrors({}); }} idPrefix={`edit-${category.id}`} autoFocus />
        <div className="adm-inline-actions">
          {errors.form && (
            <p className="adm-field-error" role="alert">
              {errors.form}
            </p>
          )}
          {category.templateCount > 0 && <p className="adm-hint">Mengganti slug mengubah alamat katalog kategori ini.</p>}
          <button type="button" className="acct-button acct-button-outline" onClick={onDone} disabled={busy}>
            Batal
          </button>
          <button type="submit" className="acct-button acct-button-dark adm-action" disabled={busy}>
            {busy ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </form>
    </li>
  );
}

function CategoryFields({
  values,
  errors,
  onChange,
  idPrefix,
  autoFocus,
}: {
  values: Values;
  errors: Errors;
  onChange: (values: Values) => void;
  idPrefix: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="adm-category-fields">
      <div className="adm-field">
        <label className="adm-label" htmlFor={`${idPrefix}-name`}>
          Nama
        </label>
        <input
          id={`${idPrefix}-name`}
          className="adm-input"
          value={values.name}
          maxLength={80}
          placeholder="Landing page"
          autoFocus={autoFocus}
          onChange={(event) => onChange({ ...values, name: event.target.value })}
          aria-invalid={errors.name ? true : undefined}
        />
        {errors.name && <p className="adm-field-error">{errors.name}</p>}
      </div>
      <div className="adm-field">
        <label className="adm-label" htmlFor={`${idPrefix}-slug`}>
          Slug
        </label>
        <input
          id={`${idPrefix}-slug`}
          className="adm-input adm-mono"
          value={values.slug}
          maxLength={100}
          placeholder="landing-page"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => onChange({ ...values, slug: event.target.value })}
          aria-invalid={errors.slug ? true : undefined}
        />
        {errors.slug && <p className="adm-field-error">{errors.slug}</p>}
      </div>
      <div className="adm-field adm-field-wide">
        <label className="adm-label" htmlFor={`${idPrefix}-description`}>
          Deskripsi <span className="adm-optional">opsional</span>
        </label>
        <input
          id={`${idPrefix}-description`}
          className="adm-input"
          value={values.description}
          maxLength={255}
          placeholder="Halaman tunggal untuk promosi produk atau acara"
          onChange={(event) => onChange({ ...values, description: event.target.value })}
          aria-invalid={errors.description ? true : undefined}
        />
        {errors.description && <p className="adm-field-error">{errors.description}</p>}
      </div>
    </div>
  );
}
