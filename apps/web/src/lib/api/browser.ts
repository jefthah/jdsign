import createClient from "openapi-fetch";

import type { components, paths } from "./schema";

/**
 * API client for Client Components. Requests go to the same origin, so the
 * session cookie is sent and the API's Origin check passes.
 */
export const browserApi = createClient<paths>({
  baseUrl: "/api/v1",
  credentials: "same-origin",
});

export type ApiError = components["schemas"]["Error"];

export const connectionErrorMessage =
  "Tidak dapat terhubung ke server JD Sign. Periksa koneksi Anda, lalu coba lagi.";
