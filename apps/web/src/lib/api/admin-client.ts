import { adminSetupPath, adminVerifyPath } from "@/lib/auth/admin-paths";

import type { ApiError } from "./browser";

/**
 * Leaves the page when an admin request failed because of the session rather
 * than the input: signed out, or the authenticator step is needed. Returns
 * true when it navigated away. For Client Components.
 */
export function leaveOnSessionProblem(status: number, failure: ApiError | undefined): boolean {
  const here = window.location.pathname + window.location.search;
  let destination: string | null = null;
  if (status === 401) {
    destination = `/login?next=${encodeURIComponent(here)}`;
  } else if (failure?.error.code === "mfa_required") {
    destination = `${adminVerifyPath}?next=${encodeURIComponent(here)}`;
  } else if (failure?.error.code === "mfa_setup_required") {
    destination = adminSetupPath;
  }
  if (destination) {
    window.location.assign(destination);
    return true;
  }

  return false;
}

export const genericErrorMessage = "Terjadi kesalahan. Silakan coba lagi.";

export type UploadResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; failure: ApiError | undefined };

/**
 * Sends a file as the raw request body with progress updates. fetch() has no
 * upload progress, so this uses XMLHttpRequest. Same origin, so the session
 * cookie and the Origin header the API checks are sent.
 */
export function uploadFile<T>(
  url: string,
  file: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadResult<T>> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    request.onload = () => {
      const body: unknown = request.response;
      if (request.status >= 200 && request.status < 300) {
        resolve({ ok: true, data: body as T });
        return;
      }
      resolve({ ok: false, status: request.status, failure: (body ?? undefined) as ApiError | undefined });
    };
    request.onerror = () => reject(new Error("network"));
    request.onabort = () => reject(new DOMException("Upload dibatalkan", "AbortError"));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}
