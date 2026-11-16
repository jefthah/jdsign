import createClient from "openapi-fetch";

import type { paths } from "./schema";

/**
 * API client for server components. It calls the Go API directly over the
 * internal address instead of going back out through Caddy.
 */
export const serverApi = createClient<paths>({
  baseUrl: process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8300/api/v1",
});
