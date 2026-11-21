import type { AdminTemplate } from "@/lib/api/admin";

import { coverUrl, statusOf } from "./format";

export function StatusBadge({ template }: { template: Pick<AdminTemplate, "status" | "archived"> }) {
  const status = statusOf(template);

  return <span className={`adm-status adm-status-${status.tone}`}>{status.label}</span>;
}

/** Small cover for lists; a lettered tile until a cover is uploaded. */
export function TemplateThumb({ template }: { template: Pick<AdminTemplate, "id" | "title" | "hasCover" | "updatedAt"> }) {
  if (!template.hasCover) {
    return (
      <span className="adm-thumb adm-thumb-empty" aria-hidden="true">
        {template.title.trim().charAt(0).toUpperCase() || "T"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- admin-only image behind the session cookie
    <img className="adm-thumb" src={coverUrl(template)} alt="" loading="lazy" decoding="async" />
  );
}

/** Two small markers: is the ZIP there, is the cover there. */
export function FileMarkers({ template }: { template: Pick<AdminTemplate, "zip" | "hasCover"> }) {
  return (
    <span className="adm-markers">
      <span className={`adm-marker ${template.zip ? "adm-marker-ok" : ""}`}>
        ZIP<span className="adm-sr">{template.zip ? " ada" : " belum ada"}</span>
      </span>
      <span className={`adm-marker ${template.hasCover ? "adm-marker-ok" : ""}`}>
        Sampul<span className="adm-sr">{template.hasCover ? " ada" : " belum ada"}</span>
      </span>
    </span>
  );
}
