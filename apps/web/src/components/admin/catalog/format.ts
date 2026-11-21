import type { AdminTemplate } from "@/lib/api/admin";

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const digits = new Intl.NumberFormat("id-ID");
// Server components render in UTC containers; the admin reads Jakarta time.
const dateTime = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});

export const maxZipBytes = 50 * 1024 * 1024;
export const maxCoverBytes = 2 * 1024 * 1024;

export function formatRupiah(value: number): string {
  return rupiah.format(value);
}

/** Thousands separators only, for the price field: 249000 → "249.000". */
export function formatDigits(value: number): string {
  return digits.format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${decimal.format(bytes / 1024)} KB`;
  }

  return `${decimal.format(bytes / (1024 * 1024))} MB`;
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** Admin-only cover URL; the version busts the browser cache after a new upload. */
export function coverUrl(template: Pick<AdminTemplate, "id" | "updatedAt">): string {
  return `/api/v1/admin/templates/${template.id}/files/cover?v=${Date.parse(template.updatedAt)}`;
}

export function zipUrl(id: number): string {
  return `/api/v1/admin/templates/${id}/files/zip`;
}

export type StatusLabel = { label: string; tone: "published" | "draft" | "archived" };

export function statusOf(template: Pick<AdminTemplate, "status" | "archived">): StatusLabel {
  if (template.archived) {
    return { label: "Diarsipkan", tone: "archived" };
  }

  return template.status === "published" ? { label: "Tayang", tone: "published" } : { label: "Draft", tone: "draft" };
}
