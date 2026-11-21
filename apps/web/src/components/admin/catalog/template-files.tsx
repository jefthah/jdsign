"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";

import { DownloadIcon } from "@/components/account/icons";
import { genericErrorMessage, leaveOnSessionProblem, uploadFile } from "@/lib/api/admin-client";
import type { AdminTemplate } from "@/lib/api/admin";
import { connectionErrorMessage } from "@/lib/api/browser";

import { coverUrl, formatBytes, maxCoverBytes, maxZipBytes, zipUrl } from "./format";

/** The ZIP buyers download and the cover shown in the catalog, each replaceable on its own. */
export function TemplateFiles({ template }: { template: AdminTemplate }) {
  return (
    <div className="adm-files">
      <UploadCard
        title="File ZIP"
        description="Yang diunduh pembeli. Maks. 50 MB; diperiksa tanpa diekstrak."
        accept=".zip,application/zip,application/x-zip-compressed"
        maxBytes={maxZipBytes}
        tooLarge="File ZIP maksimal 50 MB."
        check={(file) => (/\.zip$/i.test(file.name) ? null : "Pilih file berakhiran .zip.")}
        endpoint={(file) => `${zipUrl(template.id)}?name=${encodeURIComponent(file.name)}`}
        disabled={template.archived}
        present={template.zip != null}
        actionLabel={template.zip ? "Ganti ZIP" : "Pilih ZIP"}
      >
        {template.zip ? (
          <div className="adm-file-current">
            <span className="adm-file-icon" aria-hidden="true">
              ZIP
            </span>
            <span className="adm-file-meta">
              <strong>{template.zip.name}</strong>
              <span>{formatBytes(template.zip.size)}</span>
            </span>
            <a className="adm-icon-link" href={zipUrl(template.id)} download aria-label={`Unduh ${template.zip.name}`}>
              <DownloadIcon size={18} />
            </a>
          </div>
        ) : (
          <p className="adm-file-empty">Belum ada file ZIP.</p>
        )}
      </UploadCard>

      <UploadCard
        title="Sampul"
        description="JPG, PNG, atau WebP, maks. 2 MB dan 4000×4000 px. Disimpan ulang sebagai WebP."
        accept="image/jpeg,image/png,image/webp"
        maxBytes={maxCoverBytes}
        tooLarge="Sampul maksimal 2 MB."
        check={(file) => (/^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name) ? null : "Pilih gambar JPG, PNG, atau WebP.")}
        endpoint={() => `/api/v1/admin/templates/${template.id}/files/cover`}
        disabled={template.archived}
        present={template.hasCover}
        actionLabel={template.hasCover ? "Ganti sampul" : "Pilih gambar"}
      >
        {template.hasCover ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-only image behind the session cookie
          <img className="adm-cover-preview" src={coverUrl(template)} alt={`Sampul ${template.title}`} />
        ) : (
          <p className="adm-file-empty adm-cover-empty">Belum ada sampul.</p>
        )}
      </UploadCard>
    </div>
  );
}

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; fraction: number }
  | { kind: "processing"; name: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

function UploadCard({
  title,
  description,
  accept,
  maxBytes,
  tooLarge,
  check,
  endpoint,
  disabled,
  present,
  actionLabel,
  children,
}: {
  title: string;
  description: string;
  accept: string;
  maxBytes: number;
  tooLarge: string;
  check: (file: File) => string | null;
  endpoint: (file: File) => string;
  disabled: boolean;
  present: boolean;
  actionLabel: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const headingId = useId();
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const busy = state.kind === "uploading" || state.kind === "processing";

  useEffect(() => () => controller.current?.abort(), []);

  async function send(file: File) {
    const problem = check(file) ?? (file.size > maxBytes ? tooLarge : file.size === 0 ? "File kosong." : null);
    if (problem) {
      setState({ kind: "error", message: problem });
      return;
    }

    controller.current = new AbortController();
    setState({ kind: "uploading", name: file.name, fraction: 0 });
    try {
      const result = await uploadFile(
        endpoint(file),
        file,
        (fraction) =>
          setState(fraction >= 1 ? { kind: "processing", name: file.name } : { kind: "uploading", name: file.name, fraction }),
        controller.current.signal,
      );
      if (result.ok) {
        setState({ kind: "done" });
        router.refresh();
        return;
      }
      if (!leaveOnSessionProblem(result.status, result.failure)) {
        setState({ kind: "error", message: result.failure?.error.message ?? genericErrorMessage });
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setState({ kind: "error", message: connectionErrorMessage });
      }
    }
  }

  function pick() {
    if (!busy && !disabled) {
      input.current?.click();
    }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !busy && !disabled) {
      void send(file);
    }
  }

  return (
    <section
      className={`adm-upload ${dragging ? "adm-upload-dragging" : ""} ${present ? "adm-upload-present" : ""}`}
      aria-labelledby={headingId}
      onDragOver={(event) => {
        if (!disabled) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <header className="adm-upload-head">
        <div>
          <h3 id={headingId}>
            {title}
            <span className={`adm-check ${present ? "adm-check-ok" : ""}`}>
              <span className="adm-sr">{present ? "sudah diunggah" : "belum diunggah"}</span>
            </span>
          </h3>
          <p>{description}</p>
        </div>
      </header>

      <div className="adm-upload-body">{children}</div>

      <footer className="adm-upload-foot">
        {state.kind === "uploading" || state.kind === "processing" ? (
          <div className="adm-progress" role="status">
            <span className="adm-progress-label">
              {state.kind === "uploading" ? `Mengunggah ${state.name}… ${Math.round(state.fraction * 100)}%` : `Memeriksa ${state.name}…`}
            </span>
            <span className="adm-progress-track">
              <span
                className={`adm-progress-bar ${state.kind === "processing" ? "adm-progress-busy" : ""}`}
                style={{ width: `${state.kind === "uploading" ? Math.max(4, state.fraction * 100) : 100}%` }}
              />
            </span>
          </div>
        ) : (
          <>
            {state.kind === "error" && (
              <p className="adm-field-error" role="alert">
                {state.message}
              </p>
            )}
            {state.kind === "done" && (
              <p className="adm-saved" role="status">
                Tersimpan.
              </p>
            )}
            <button type="button" className="acct-button acct-button-outline adm-upload-button" onClick={pick} disabled={disabled}>
              {actionLabel}
            </button>
            <span className="adm-drop-hint">atau seret file ke sini</span>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept={accept}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              void send(file);
            }
          }}
        />
      </footer>
    </section>
  );
}
