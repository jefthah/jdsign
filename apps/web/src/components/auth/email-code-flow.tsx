"use client";

import { use, useState, type FormEvent } from "react";
import { browser } from "react-dom";

import { defaultNextPath, safeNextPath } from "@/lib/auth/paths";

import type { AuthVariant } from "./auth-shell";
import { styles } from "./auth-styles";
import { ArrowLeftIcon, ArrowRightIcon, GoogleIcon, MailIcon } from "./icons";
import { OtpInput } from "./otp-input";
import { formatSeconds, googleErrorNotice, useEmailCode, type Notice } from "./use-email-code";

const copy = {
  login: {
    title: "Masuk ke JD Sign",
    lead: "Selamat datang kembali. Masuk dengan Google, atau dengan kode yang kami kirim ke email Anda.",
    hint: "Kode berlaku 10 menit dan hanya bisa dipakai sekali.",
    submit: "Kirim kode masuk",
    google: "Masuk dengan Google",
    legal: "Dengan melanjutkan",
  },
  register: {
    title: "Buat akun JD Sign",
    lead: "Daftar dengan Google, atau cukup pakai email. Tanpa kata sandi, kami kirim kode 6 digit untuk verifikasi.",
    hint: "Akun langsung aktif setelah kode diverifikasi.",
    submit: "Kirim kode verifikasi",
    google: "Daftar dengan Google",
    legal: "Dengan mendaftar",
  },
} as const;

/**
 * Email → code sign-in used by /login and /register. It reads sessionStorage
 * and the URL, so it renders only in the browser; the server sends
 * <EmailCodeFallback> in its place.
 */
export function EmailCodeFlow({ variant }: { variant: AuthVariant }) {
  use(browser("Langkah masuk tersimpan di sessionStorage."));

  const [query] = useState(() => new URLSearchParams(window.location.search));
  const next = safeNextPath(query.get("next"));
  const [remember, setRemember] = useState(true);
  const [initialNotice] = useState<Notice | null>(() => googleErrorNotice(query.get("error")));
  const flow = useEmailCode({
    storageKey: "jdsign:pending-login-code",
    remember,
    initialNotice,
    // A full navigation lets the server render the next page with the new session cookie.
    onSignedIn: () => window.location.assign(next),
  });
  const { busy, codeError, secondsUntilResend } = flow;

  if (flow.step === "code") {
    return (
      <div className={styles.column}>
        <button type="button" className={styles.back} onClick={flow.changeEmail}>
          <ArrowLeftIcon />
          Ganti email
        </button>
        <div className={styles.heading}>
          <span className={styles.headingIcon}>
            <MailIcon />
          </span>
          <h1 className={styles.title}>Cek email Anda</h1>
          <p className={styles.lead}>
            Masukkan kode 6 digit yang kami kirim ke <strong>{flow.pendingEmail}</strong>.
          </p>
        </div>

        {flow.notice && <NoticeBanner notice={flow.notice} />}

        <form className={styles.form} onSubmit={flow.submitCode} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="code">
              Kode verifikasi
            </label>
            <OtpInput
              value={flow.code}
              onChange={flow.changeCode}
              invalid={codeError !== null}
              busy={busy === "verify"}
              describedBy={codeError ? "code-error" : "code-hint"}
            />
            {codeError ? (
              <p id="code-error" className={styles.error} role="alert">
                {codeError}
              </p>
            ) : (
              <p id="code-hint" className={styles.hint}>
                Kode berlaku 10 menit, maksimal 5 kali percobaan.
              </p>
            )}
          </div>

          <label className={styles.remember}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Tetap masuk di perangkat ini
          </label>

          <SubmitButton busy={busy === "verify"} label="Verifikasi dan masuk" busyLabel="Memeriksa kode…" />
        </form>

        <div className={styles.resend}>
          <p className={styles.resendRow}>
            <span>Belum menerima kode?</span>{" "}
            {secondsUntilResend > 0 ? (
              <span className={styles.resendWait}>
                Kirim ulang dalam <span className={styles.countdown}>{formatSeconds(secondsUntilResend)}</span>
              </span>
            ) : (
              <button type="button" className={styles.textButton} disabled={busy !== null} onClick={flow.resendCode}>
                {busy === "resend" ? "Mengirim…" : "Kirim ulang kode"}
              </button>
            )}
          </p>
          <p className={styles.hint}>Tidak ada di kotak masuk? Cek folder spam atau promosi.</p>
        </div>
      </div>
    );
  }

  return (
    <EmailStep
      variant={variant}
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

/** Server-rendered stand-in for the email step until the browser takes over. */
export function EmailCodeFallback({ variant }: { variant: AuthVariant }) {
  return (
    <EmailStep
      variant={variant}
      email=""
      onEmailChange={() => {}}
      emailError={null}
      busy={false}
      onSubmit={(event) => event.preventDefault()}
      next={defaultNextPath}
      notice={null}
    />
  );
}

function EmailStep({
  variant,
  email,
  onEmailChange,
  emailError,
  busy,
  onSubmit,
  next,
  notice,
}: {
  variant: AuthVariant;
  email: string;
  onEmailChange: (value: string) => void;
  emailError: string | null;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  next: string;
  notice: Notice | null;
}) {
  const text = copy[variant];

  return (
    <div className={styles.column}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{text.title}</h1>
        <p className={styles.lead}>{text.lead}</p>
      </div>

      {notice && <NoticeBanner notice={notice} />}

      <div className={styles.methods}>
        <a className={styles.google} href={`/api/v1/auth/google?next=${encodeURIComponent(next)}`}>
          <GoogleIcon />
          {text.google}
        </a>

        <div className={styles.divider}>atau dengan email</div>

        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              Alamat email
            </label>
            <div className={`${styles.inputWrap} ${emailError ? styles.invalid : ""}`}>
              <MailIcon />
              <input
                id="email"
                name="email"
                className={styles.input}
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
              <p id="email-error" className={styles.error} role="alert">
                {emailError}
              </p>
            ) : (
              <p id="email-hint" className={styles.hint}>
                {text.hint}
              </p>
            )}
          </div>
          <SubmitButton busy={busy} label={text.submit} busyLabel="Mengirim kode…" />
        </form>
      </div>

      <p className={styles.legal}>
        {text.legal}, Anda menyetujui <strong>Syarat Layanan</strong> dan <strong>Kebijakan Privasi</strong> JD Sign.
      </p>
    </div>
  );
}

export function SubmitButton({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button type="submit" className={styles.primary} disabled={busy} aria-busy={busy}>
      {busy && <span className={styles.spinner} aria-hidden="true" />}
      <span>{busy ? busyLabel : label}</span>
      {!busy && <ArrowRightIcon />}
    </button>
  );
}

export function NoticeBanner({ notice }: { notice: Notice }) {
  return (
    <p
      className={`${styles.notice} ${notice.tone === "error" ? styles.noticeError : styles.noticeSuccess}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      {notice.text}
    </p>
  );
}
