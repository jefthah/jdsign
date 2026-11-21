import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminAuthCard, AdminAuthShell, AdminAuthSkeleton, siteExit } from "@/components/admin/admin-auth-shell";
import { AuthenticatorForm, SignOutButton } from "@/components/admin/authenticator-form";
import { QrCode } from "@/components/admin/qr-code";
import { SecretKey } from "@/components/admin/secret-key";
import { requireAdminSetup } from "@/lib/api/admin";
import { adminNextParam } from "@/lib/auth/admin-paths";

import "@/components/admin/admin.css";

export const metadata: Metadata = {
  title: "Pasang authenticator — Panel admin JD Sign",
  robots: { index: false, follow: false },
};

export default function AdminAuthenticatorSetupPage(props: PageProps<"/admin/mfa/setup">) {
  return (
    <AdminAuthShell exit={siteExit}>
      <Suspense fallback={<AdminAuthSkeleton />}>
        <Setup searchParams={props.searchParams} />
      </Suspense>
    </AdminAuthShell>
  );
}

async function Setup({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const state = await requireAdminSetup(adminNextParam((await searchParams).next));

  if (state.kind === "unavailable") {
    return (
      <AdminAuthCard step={3} title="Panel admin belum siap" lead={state.message}>
        <p className="adm-auth-note">
          Pengelola server perlu menjalankan ulang konfigurasi staging agar kunci enkripsi dibuat, lalu deploy ulang.
        </p>
        <div className="adm-auth-help-row">
          <p>Akun Anda tetap bisa dipakai seperti biasa.</p>
          <SignOutButton />
        </div>
      </AdminAuthCard>
    );
  }

  const { setup } = state;

  return (
    <AdminAuthCard
      step={3}
      title="Amankan panel admin"
      lead="Admin JD Sign wajib memakai aplikasi authenticator. Setelah terpasang, setiap kali masuk Anda diminta kode 6 digit dari aplikasi itu."
    >
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

      <div className="adm-auth-help-row">
        <p>Kunci ini hanya tampil sampai authenticator aktif. Jangan bagikan.</p>
        <SignOutButton />
      </div>
    </AdminAuthCard>
  );
}
