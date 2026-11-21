import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminAuthCard, AdminAuthShell, AdminAuthSkeleton, siteExit } from "@/components/admin/admin-auth-shell";
import { AuthenticatorForm, SignOutButton } from "@/components/admin/authenticator-form";
import { requireAdminAwaitingCode } from "@/lib/api/admin";
import { getSignedInAccount } from "@/lib/api/session";
import { adminNextParam } from "@/lib/auth/admin-paths";

export const metadata: Metadata = {
  title: "Kode authenticator — Panel admin JD Sign",
  robots: { index: false, follow: false },
};

export default function AdminAuthenticatorCodePage(props: PageProps<"/admin/mfa">) {
  return (
    <AdminAuthShell exit={siteExit}>
      <Suspense fallback={<AdminAuthSkeleton />}>
        <CodeStep searchParams={props.searchParams} />
      </Suspense>
    </AdminAuthShell>
  );
}

async function CodeStep({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminAwaitingCode(adminNextParam((await searchParams).next));
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
          Demi keamanan, kode diminta lagi setelah 1 jam tanpa aktivitas atau 12 jam sejak kode terakhir.
        </p>
        <p className="adm-auth-note">
          Ponsel hilang? Minta pengelola server me-reset authenticator Anda, lalu pasang ulang saat masuk berikutnya.
        </p>
      </div>
    </AdminAuthCard>
  );
}
