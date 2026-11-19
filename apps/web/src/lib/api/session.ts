import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import type { components } from "./schema";
import { serverApi } from "./server";

export type Account = components["schemas"]["Account"];

const sessionCookieName = "jdsign_session";

/**
 * Returns the signed-in account, or null when there is no valid session.
 * It reads the request cookies, so callers must render inside <Suspense>.
 * Cached per render, so the header menu and the page share one /me call.
 */
export const getSignedInAccount = cache(async (): Promise<Account | null> => {
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
});

/** Like getSignedInAccount, but sends signed-out visitors to the login page and back to `path` afterwards. */
export async function requireAccount(path: string): Promise<Account> {
  const account = await getSignedInAccount();
  if (!account) {
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }

  return account;
}
