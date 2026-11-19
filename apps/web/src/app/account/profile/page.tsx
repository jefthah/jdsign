import type { Metadata } from "next";
import { Suspense } from "react";

import { LogoutButton } from "@/components/account/account-nav";
import { roleLabels } from "@/components/account/links";
import { PageHeader, PageSkeleton } from "@/components/account/page-parts";
import { requireAccount } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Profil & keamanan — JD Sign",
};

export default function ProfilePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Profile />
    </Suspense>
  );
}

async function Profile() {
  const account = await requireAccount("/account/profile");

  return (
    <>
      <PageHeader
        eyebrow="AKUN SAYA"
        title="Profil & keamanan"
        lead="Data akun dan cara Anda masuk ke JD Sign."
      />

      <section className="acct-card" aria-labelledby="profile-info">
        <div className="acct-card-head">
          <div>
            <h2 id="profile-info">Informasi akun</h2>
            <p>Dipakai untuk pesanan, invoice, dan email dari JD Sign.</p>
          </div>
        </div>
        <dl className="acct-details">
          <div>
            <dt>Nama</dt>
            <dd>{account.name}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>
              {account.email}
              <small>Alamat email tidak bisa diganti karena dipakai untuk masuk.</small>
            </dd>
          </div>
          <div>
            <dt>Status email</dt>
            <dd>
              <span className={`acct-badge ${account.emailVerified ? "acct-badge-lime" : ""}`}>
                <span className="acct-badge-dot" />
                {account.emailVerified ? "Terverifikasi" : "Belum terverifikasi"}
              </span>
            </dd>
          </div>
          <div>
            <dt>Peran</dt>
            <dd>{roleLabels[account.role]}</dd>
          </div>
        </dl>
      </section>

      <section className="acct-card" aria-labelledby="profile-signin">
        <div className="acct-card-head">
          <div>
            <h2 id="profile-signin">Cara masuk</h2>
            <p>JD Sign tidak memakai kata sandi.</p>
          </div>
        </div>
        <dl className="acct-details">
          <div>
            <dt>Kode lewat email</dt>
            <dd>
              Aktif
              <small>Kode 6 digit dikirim ke {account.email}, berlaku 10 menit dan hanya bisa dipakai sekali.</small>
            </dd>
          </div>
          <div>
            <dt>Google</dt>
            <dd>
              Tersedia
              <small>Masuk dengan akun Google yang memakai alamat email yang sama.</small>
            </dd>
          </div>
        </dl>
      </section>

      <section className="acct-card" aria-labelledby="profile-session">
        <div className="acct-card-head">
          <h2 id="profile-session">Sesi</h2>
        </div>
        <div className="acct-card-actions">
          <p>Keluar dari perangkat ini jika Anda memakai komputer bersama atau tidak lagi menggunakannya.</p>
          <LogoutButton />
        </div>
      </section>
    </>
  );
}
