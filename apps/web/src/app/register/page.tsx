import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { EmailCodeFallback, EmailCodeFlow } from "@/components/auth/email-code-flow";
import { RedirectIfSignedIn } from "@/components/auth/redirect-if-signed-in";

export const metadata: Metadata = {
  title: "Daftar — JD Sign",
  description: "Buat akun JD Sign cukup dengan email. Kami kirim kode verifikasi, tanpa kata sandi.",
};

export default function RegisterPage() {
  return (
    <AuthShell variant="register">
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <Suspense fallback={<EmailCodeFallback variant="register" />}>
        <EmailCodeFlow variant="register" />
      </Suspense>
    </AuthShell>
  );
}
