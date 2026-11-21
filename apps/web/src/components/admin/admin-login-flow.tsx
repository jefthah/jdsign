"use client";

import Link from "next/link";
import { use, useState, type FormEvent } from "react";
import { browser } from "react-dom";

import { NoticeBanner, SubmitButton } from "@/components/auth/email-code-flow";
import { ArrowRightIcon, GoogleIcon, MailIcon } from "@/components/auth/icons";
import { OtpInput } from "@/components/auth/otp-input";
import {
  formatSeconds,
  googleErrorNotice,
  useEmailCode,
  type Account,
  type Notice,
} from "@/components/auth/use-email-code";
import { browserApi } from "@/lib/api/browser";
import { adminHomePath, adminLoginHref, adminLoginPath, adminStepHref, adminVerifyPath } from "@/lib/auth/admin-paths";

import { AdminAuthCard } from "./admin-auth-shell";

/**
 * Steps 1 and 2 of the admin sign-in: email, then the code sent to it. Admins
 * go on to the authenticator step; anyone else sees <NotAdmin>. It reads
 * sessionStorage, so it renders only in the browser; the server sends
 * <AdminLoginFallback> in its place.
 *
 * `next` is an admin page, already checked with safeAdminNextPath.
 */
export function AdminLoginFlow({ next }: { next: string }) {
  use(browser("Langkah masuk admin tersimpan di sessionStorage."));

  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  // A failed Google sign-in comes back here with ?error=<code>.
  const [initialNotice] = useState(() => googleErrorNotice(new URLSearchParams(window.location.search).get("error")));
  const flow = useEmailCode({
    storageKey: "jdsign:pending-admin-code",
    // The admin session ends when the browser closes.
    remember: false,
    initialNotice,
    onSignedIn: (account: Account) => {
      if (account.role !== "admin") {
        setSignedInAs(account.email);
        return;
      }
      // A full navigation, not router.push, so the server renders the authenticator step with the new session cookie.
      window.location.assign(adminStepHref(adminVerifyPath, next));
    },
  });
  const { busy, codeError, secondsUntilResend } = flow;

  if (signedInAs) {
    return <NotAdmin email={signedInAs} />;
  }

  if (flow.step === "email") {
    return (
      <EmailStep
        email={flow.email}
        onEmailChange={flow.typeEmail}
        emailError={flow.emailError}
        busy={busy === "send"}
        onSubmit={flow.submitEmail}
        next={next}
        notice={flow.notice}
      />
    );
  }

  return (
    <AdminAuthCard
      step={2}
      title="Cek email Anda"
      lead={
        <>
          Kode 6 digit sudah dikirim ke <strong>{flow.pendingEmail}</strong>. Buka email itu, lalu masukkan kodenya di
          bawah.
        </>
      }
    >
      {flow.notice && <NoticeBanner notice={flow.notice} />}

      <form className="auth-form" onSubmit={flow.submitCode} noValidate>
        <div className="auth-field">
          <label className="auth-label" htmlFor="code">
            Kode dari email
          </label>
          <OtpInput
            value={flow.code}
            onChange={flow.changeCode}
            invalid={codeError !== null}
            busy={busy === "verify"}
            describedBy={codeError ? "code-error" : "code-hint"}
          />
          {codeError ? (
            <p id="code-error" className="auth-error" role="alert">
              {codeError}
            </p>
          ) : (
            <p id="code-hint" className="auth-hint">
              Kode berlaku 10 menit, maksimal 5 kali percobaan.
            </p>
          )}
        </div>
        <SubmitButton busy={busy === "verify"} label="Lanjutkan" busyLabel="Memeriksa kode…" />
      </form>

      <div className="adm-auth-help">
        <div className="adm-auth-help-row">
          <p>
            Belum menerima kode?{" "}
            {secondsUntilResend > 0 ? (
              <strong className="adm-auth-countdown">Kirim ulang dalam {formatSeconds(secondsUntilResend)}</strong>
            ) : (
              <button type="button" className="adm-auth-link" disabled={busy !== null} onClick={flow.resendCode}>
                {busy === "resend" ? "Mengirim…" : "Kirim ulang kode"}
              </button>
            )}
          </p>
          <button type="button" className="adm-auth-link" onClick={flow.changeEmail}>
            Ganti email
          </button>
        </div>
        <p className="adm-auth-note">Tidak ada di kotak masuk? Cek folder spam atau promosi.</p>
      </div>
    </AdminAuthCard>
  );
}

/** Server-rendered stand-in for the email step until the browser takes over. */
export function AdminLoginFallback() {
  return (
    <EmailStep
      email=""
      onEmailChange={() => {}}
      emailError={null}
      busy={false}
      onSubmit={(event) => event.preventDefault()}
      next={adminHomePath}
      notice={null}
    />
  );
}

function EmailStep({
  email,
  onEmailChange,
  emailError,
  busy,
  onSubmit,
  next,
  notice,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  emailError: string | null;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  next: string;
  notice: Notice | null;
}) {
  // Google returns to this page, which then sends admins on to the authenticator step.
  const googleHref = `/api/v1/auth/google?next=${encodeURIComponent(adminLoginHref(next))}`;

  return (
    <AdminAuthCard
      step={1}
      title="Masuk ke panel admin"
      lead="Khusus pengelola JD Sign. Setelah kode email, Anda juga diminta kode dari aplikasi authenticator."
    >
      {notice && <NoticeBanner notice={notice} />}

      <a className="auth-google" href={googleHref}>
        <GoogleIcon />
        Lanjut dengan Google
      </a>

      <div className="auth-divider">atau</div>

      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <div className="auth-field">
          <label className="auth-label" htmlFor="email">
            Email admin
          </label>
          <div className={`auth-input-wrap ${emailError ? "auth-invalid" : ""}`}>
            <MailIcon />
            <input
              id="email"
              name="email"
              className="auth-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="nama@email.com"
              maxLength={255}
              required
              autoFocus
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              aria-invalid={emailError !== null}
              aria-describedby={emailError ? "email-error" : "email-hint"}
            />
          </div>
          {emailError ? (
            <p id="email-error" className="auth-error" role="alert">
              {emailError}
            </p>
          ) : (
            <p id="email-hint" className="auth-hint">
              Kode 6 digit berlaku 10 menit dan hanya bisa dipakai sekali.
            </p>
          )}
        </div>
        <SubmitButton busy={busy} label="Kirim kode masuk" busyLabel="Mengirim kode…" />
      </form>

      <p className="adm-auth-note">
        Hanya akun yang sudah dijadikan admin oleh pengelola server yang bisa masuk ke sini.
      </p>
    </AdminAuthCard>
  );
}

/**
 * Shown to a signed-in account without the admin role, right after signing in
 * here or when it opens this page with a session already.
 */
export function NotAdmin({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await browserApi.POST("/auth/logout");
    } finally {
      // A full reload drops the old session from every server-rendered part.
      window.location.assign(adminLoginPath);
    }
  }

  return (
    <AdminAuthCard
      title="Akun ini bukan admin"
      lead={
        <>
          Anda masuk sebagai <strong>{email}</strong>. Akun ini tidak punya akses ke panel admin.
        </>
      }
    >
      <Link className="auth-primary" href="/account">
        <span>Buka akun saya</span>
        <ArrowRightIcon />
      </Link>
      <div className="adm-auth-help">
        <div className="adm-auth-help-row">
          <p>Punya akun admin lain?</p>
          <button type="button" className="adm-auth-link" disabled={busy} onClick={() => void signOut()}>
            {busy ? "Keluar…" : "Keluar dan ganti email"}
          </button>
        </div>
        <p className="adm-auth-note">
          Akses admin hanya bisa diberikan oleh pengelola server. Hubungi mereka bila akun ini seharusnya admin.
        </p>
      </div>
    </AdminAuthCard>
  );
}
