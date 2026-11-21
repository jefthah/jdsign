import Link from "next/link";

import { getSignedInAccount } from "@/lib/api/session";

import { AccountMenu } from "./account-menu";
import { summarize } from "./links";

/** Account menu for the account and admin topbars, or "Masuk". Render inside <Suspense>. */
export async function TopbarAccount() {
  const account = await getSignedInAccount();
  if (!account) {
    return (
      <Link className="acct-login-link" href="/login">
        Masuk
      </Link>
    );
  }

  return <AccountMenu account={summarize(account)} />;
}
