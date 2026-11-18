import { redirect } from "next/navigation";

import { getSignedInAccount } from "@/lib/api/session";

/** Sends people who already have a session to their account. Render inside <Suspense>. */
export async function RedirectIfSignedIn() {
  if (await getSignedInAccount()) {
    redirect("/account");
  }

  return null;
}
