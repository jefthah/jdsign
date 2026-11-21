import type { Metadata } from "next";
import { Suspense } from "react";

import { ShieldIcon } from "@/components/account/icons";
import { AuthenticatorForm, SignOutButton } from "@/components/admin/authenticator-form";
import { AdminMfaShell, AdminMfaSkeleton } from "@/components/admin/mfa-shell";
import { QrCode } from "@/components/admin/qr-code";
import { SecretKey } from "@/components/admin/secret-key";
import { styles } from "@/components/auth/auth-styles";
import { requireAdminSetup } from "@/lib/api/admin";

export const metadata: Metadata = {
  title: "Pasang authenticator — Panel admin JD Sign",
  robots: { index: false, follow: false },
};

export default function AdminAuthenticatorSetupPage() {
  return (
    <AdminMfaShell>
      <Suspense fallback={<AdminMfaSkeleton />}>
        <Setup />
      </Suspense>
    </AdminMfaShell>
  );
}

async function Setup() {
  const state = await requireAdminSetup();

  if (state.kind === "unavailable") {
    return (
      <div className={`${styles.column} adm-mfa-column`}>
        <div className={styles.heading}>
          <span className={styles.headingIcon}>
            <ShieldIcon size={22} />
          </span>
          <h1 className={styles.title}>Panel admin belum siap</h1>
          <p className={styles.lead}>{state.message}</p>
        </div>
        <p className="adm-help">
          Pengelola server perlu menjalankan ulang konfigurasi staging agar kunci enkripsi dibuat, lalu deploy ulang.
        </p>
        <div className="adm-mfa-actions">
          <span className="adm-help">Akun Anda tetap bisa dipakai seperti biasa.</span>
          <SignOutButton />
        </div>
      </div>
    );
  }

  const { setup } = state;

  return (
    <div className={`${styles.column} adm-mfa-column`}>
      <div className={styles.heading}>
        <span className={styles.headingIcon}>
          <ShieldIcon size={22} />
        </span>
        <h1 className={styles.title}>Amankan panel admin</h1>
        <p className={styles.lead}>
          Admin JD Sign wajib memakai aplikasi authenticator. Setelah terpasang, setiap kali masuk Anda diminta kode 6
          digit dari aplikasi itu.
        </p>
      </div>

      <ol className="adm-steps">
        <li>
          <div>
            <p className="adm-step-title">Siapkan aplikasi authenticator</p>
            <p className="adm-step-text">
              Misalnya Google Authenticator, Microsoft Authenticator, atau 2FAS di ponsel Anda.
            </p>
          </div>
        </li>
        <li>
          <div>
            <p className="adm-step-title">Pindai kode QR ini</p>
            <p className="adm-step-text">Di aplikasi, pilih tambah akun, lalu arahkan kamera ke kode QR.</p>
            <div className="adm-qr-card">
              <div className="adm-qr">
                <QrCode value={setup.otpauthUri} label="Kode QR untuk menambahkan JD Sign ke aplikasi authenticator" />
              </div>
              <SecretKey secret={setup.secret} />
            </div>
          </div>
        </li>
        <li>
          <div>
            <p className="adm-step-title">Masukkan kode yang muncul</p>
            <p className="adm-step-text">Aplikasi menampilkan kode 6 digit untuk JD Sign.</p>
            <AuthenticatorForm mode="setup" />
          </div>
        </li>
      </ol>

      <div className="adm-mfa-actions">
        <span className="adm-help">Kunci ini hanya tampil sampai authenticator aktif. Jangan bagikan.</span>
        <SignOutButton />
      </div>
    </div>
  );
}
