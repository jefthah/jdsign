import { cookies } from "next/headers";

import type { components } from "./schema";
import { serverApi } from "./server";

export type Account = components["schemas"]["Account"];

const sessionCookieName = "jdsign_session";

/**
 * Returns the signed-in account, or null when there is no valid session.
 * It reads the request cookies, so callers must render inside <Suspense>.
 */
export async function getSignedInAccount(): Promise<Account | null> {
  const session = (await cookies()).get(sessionCookieName)?.value;
  if (!session) {
    return null;
  }

  const { data } = await serverApi
    .GET("/me", {
      headers: { cookie: `${sessionCookieName}=${session}` },
      signal: AbortSignal.timeout(3000),
    })
    .catch(() => ({ data: undefined }));

  return data ?? null;
}
