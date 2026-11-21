import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AdminAuthShell, buyerExit } from "@/components/admin/admin-auth-shell";
import { AdminLoginFallback, AdminLoginFlow, NotAdmin } from "@/components/admin/admin-login-flow";
import { getAdminAccess } from "@/lib/api/admin";
import { getSignedInAccount } from "@/lib/api/session";
import { adminSetupPath, adminVerifyPath, safeAdminNextPath } from "@/lib/auth/admin-paths";

export const metadata: Metadata = {
  title: "Masuk — Panel admin JD Sign",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage(props: PageProps<"/admin/login">) {
  return (
    <AdminAuthShell exit={buyerExit}>
      <Suspense fallback={<AdminLoginFallback />}>
        <SignInStep searchParams={props.searchParams} />
      </Suspense>
    </AdminAuthShell>
  );
}

/** Signed-in admins skip ahead to their next step; everyone else signs in here. */
async function SignInStep({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requested = (await searchParams).next;
  const next = safeAdminNextPath(Array.isArray(requested) ? requested[0] : requested);

  switch (await getAdminAccess()) {
    case "verified":
      redirect(next);
    case "needs-code":
      redirect(`${adminVerifyPath}?next=${encodeURIComponent(next)}`);
    case "needs-setup":
      redirect(adminSetupPath);
    case "not-admin": {
      const account = await getSignedInAccount();
      if (account) {
        return <NotAdmin email={account.email} />;
      }
      break;
    }
  }

  return <AdminLoginFlow next={next} />;
}
