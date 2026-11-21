"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { genericErrorMessage, leaveOnSessionProblem } from "@/lib/api/admin-client";
import type { AdminTemplate } from "@/lib/api/admin";
import { browserApi, connectionErrorMessage } from "@/lib/api/browser";

type Action = "publish" | "unpublish" | "archive" | "restore";

/** Show on the site, take it off, archive, or restore. */
export function TemplateActions({ template }: { template: AdminTemplate }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = template.zip != null && template.hasCover;

  async function run(action: Action) {
    if (busy) {
      return;
    }
    if (
      action === "archive" &&
      !window.confirm(`Arsipkan "${template.title}"? Template hilang dari situs dan menjadi draft. Pembelian lama tidak terpengaruh.`)
    ) {
      return;
    }
    setBusy(action);
    setError(null);

    const options = { params: { path: { id: template.id } } };
    try {
      const result =
        action === "publish"
          ? await browserApi.POST("/admin/templates/{id}/publish", options)
          : action === "unpublish"
            ? await browserApi.POST("/admin/templates/{id}/unpublish", options)
            : action === "archive"
              ? await browserApi.DELETE("/admin/templates/{id}", options)
              : await browserApi.POST("/admin/templates/{id}/restore", options);
      if (result.data) {
        router.refresh();
      } else if (!leaveOnSessionProblem(result.response.status, result.error)) {
        setError(result.error?.error.message ?? genericErrorMessage);
      }
    } catch {
      setError(connectionErrorMessage);
    }
    setBusy(null);
  }

  return (
    <div className="adm-actions">
      <div className="adm-actions-buttons">
        {template.archived ? (
          <button type="button" className="acct-button acct-button-dark adm-action" onClick={() => run("restore")} disabled={busy !== null}>
            {busy === "restore" ? "Memulihkan…" : "Pulihkan sebagai draft"}
          </button>
        ) : (
          <>
            {template.status === "published" ? (
              <button type="button" className="acct-button acct-button-outline" onClick={() => run("unpublish")} disabled={busy !== null}>
                {busy === "unpublish" ? "Menurunkan…" : "Turunkan ke draft"}
              </button>
            ) : (
              <button
                type="button"
                className="acct-button acct-button-dark adm-action adm-action-publish"
                onClick={() => run("publish")}
                disabled={busy !== null || !ready}
                title={ready ? undefined : "Unggah file ZIP dan sampul dulu"}
              >
                {busy === "publish" ? "Menayangkan…" : "Tayangkan"}
              </button>
            )}
            <button type="button" className="acct-button adm-button-quiet" onClick={() => run("archive")} disabled={busy !== null}>
              {busy === "archive" ? "Mengarsipkan…" : "Arsipkan"}
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="adm-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
