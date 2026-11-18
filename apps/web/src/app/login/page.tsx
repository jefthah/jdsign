import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { EmailCodeFallback, EmailCodeFlow } from "@/components/auth/email-code-flow";
import { RedirectIfSignedIn } from "@/components/auth/redirect-if-signed-in";

export const metadata: Metadata = {
  title: "Masuk — JD Sign",
  description: "Masuk ke JD Sign dengan kode yang dikirim ke email Anda, tanpa kata sandi.",
};

export default function LoginPage() {
  return (
    <AuthShell variant="login">
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <Suspense fallback={<EmailCodeFallback variant="login" />}>
        <EmailCodeFlow variant="login" />
      </Suspense>
    </AuthShell>
  );
}
