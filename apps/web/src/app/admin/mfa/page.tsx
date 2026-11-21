import type { Metadata } from "next";
import { Suspense } from "react";

import { ShieldIcon } from "@/components/account/icons";
import { AuthenticatorForm, SignOutButton } from "@/components/admin/authenticator-form";
import { AdminMfaShell, AdminMfaSkeleton } from "@/components/admin/mfa-shell";
import { styles } from "@/components/auth/auth-styles";
import { requireAdminAwaitingCode } from "@/lib/api/admin";

export const metadata: Metadata = {
  title: "Kode authenticator — Panel admin JD Sign",
  robots: { index: false, follow: false },
};

export default function AdminAuthenticatorCodePage() {
  return (
    <AdminMfaShell>
      <Suspense fallback={<AdminMfaSkeleton />}>
        <CodeStep />
      </Suspense>
    </AdminMfaShell>
  );
}

async function CodeStep() {
  await requireAdminAwaitingCode();

  return (
    <div className={styles.column}>
      <div className={styles.heading}>
        <span className={styles.headingIcon}>
          <ShieldIcon size={22} />
        </span>
        <h1 className={styles.title}>Masukkan kode authenticator</h1>
        <p className={styles.lead}>
          Buka aplikasi authenticator di ponsel Anda, lalu masukkan kode 6 digit untuk <strong>JD Sign</strong>.
        </p>
      </div>

      <AuthenticatorForm mode="verify" />

      <div className="adm-mfa-actions">
        <span className="adm-help">Ponsel hilang? Minta pengelola server me-reset authenticator Anda.</span>
        <SignOutButton />
      </div>
    </div>
  );
}
