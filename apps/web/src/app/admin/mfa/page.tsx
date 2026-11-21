import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminAuthCard, AdminAuthShell, AdminAuthSkeleton, siteExit } from "@/components/admin/admin-auth-shell";
import { AuthenticatorForm, SignOutButton } from "@/components/admin/authenticator-form";
import { requireAdminAwaitingCode } from "@/lib/api/admin";
import { getSignedInAccount } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Kode authenticator — Panel admin JD Sign",
  robots: { index: false, follow: false },
};

export default function AdminAuthenticatorCodePage() {
  return (
    <AdminAuthShell exit={siteExit}>
      <Suspense fallback={<AdminAuthSkeleton />}>
        <CodeStep />
      </Suspense>
    </AdminAuthShell>
  );
}

async function CodeStep() {
  await requireAdminAwaitingCode();
  const account = await getSignedInAccount();

  return (
    <AdminAuthCard
      step={3}
      title="Masukkan kode authenticator"
      lead={
        <>
          Buka aplikasi authenticator di ponsel Anda, lalu masukkan kode 6 digit untuk <strong>JD Sign</strong>.
        </>
      }
    >
      <AuthenticatorForm mode="verify" />

      <div className="adm-auth-help">
        <div className="adm-auth-help-row">
          {account && (
            <p>
              Masuk sebagai <strong>{account.email}</strong>
            </p>
          )}
          <SignOutButton />
        </div>
        <p className="adm-auth-note">
          Ponsel hilang? Minta pengelola server me-reset authenticator Anda, lalu pasang ulang saat masuk berikutnya.
        </p>
      </div>
    </AdminAuthCard>
  );
}
