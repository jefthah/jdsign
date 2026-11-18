"use client";

import { use, useState, useSyncExternalStore, type FormEvent } from "react";
import { browser } from "react-dom";

import { browserApi, connectionErrorMessage, type ApiError } from "@/lib/api/browser";
import { defaultNextPath, safeNextPath } from "@/lib/auth/paths";

import type { AuthVariant } from "./auth-shell";
import { styles } from "./auth-styles";
import { ArrowRightIcon, GoogleIcon, MailIcon } from "./icons";
import { OtpInput } from "./otp-input";

type Step = "email" | "code";
type Busy = "send" | "verify" | "resend" | null;
type Notice = { tone: "error" | "success"; text: string };
type PendingCode = { email: string; resendAt: number; expiresAt: number };

/** Survives a page refresh during the code step; cleared after signing in. */
const storageKey = "jdsign:pending-login-code";

const copy = {
  login: {
    title: "Masuk ke JD Sign",
    lead: "Masukkan email akun Anda. Kami kirim kode 6 digit untuk masuk, tanpa kata sandi.",
    hint: "Kode berlaku 10 menit dan hanya bisa dipakai sekali.",
    submit: "Kirim kode masuk",
    google: "Lanjut dengan Google",
    legal: "Dengan melanjutkan",
  },
  register: {
    title: "Buat akun JD Sign",
    lead: "Cukup email, tanpa kata sandi. Kami kirim kode 6 digit untuk memastikan email itu milik Anda.",
    hint: "Akun langsung aktif setelah kode diverifikasi.",
    submit: "Kirim kode verifikasi",
    google: "Daftar dengan Google",
    legal: "Dengan mendaftar",
  },
} as const;

/** Messages for the ?error= codes the API's Google callback redirects with. */
const googleErrors: Record<string, string> = {
  google_unavailable: "Login Google belum tersedia. Untuk sementara, masuk dengan kode email.",
  google_cancelled: "Login Google dibatalkan. Anda bisa mencoba lagi atau memakai kode email.",
  google_state: "Sesi login Google sudah berakhir. Silakan coba lagi.",
  google_failed: "Login Google gagal. Coba lagi atau masuk dengan kode email.",
  google_unverified: "Email akun Google Anda belum terverifikasi. Silakan masuk dengan kode email.",
  account_inactive: "Akun ini sedang dinonaktifkan. Hubungi tim JD Sign untuk bantuan.",
};

/**
 * Email → code sign-in used by /login and /register. It reads sessionStorage
 * and the URL, so it renders only in the browser; the server sends
 * <EmailCodeFallback> in its place.
 */
export function EmailCodeFlow({ variant }: { variant: AuthVariant }) {
  use(browser("Langkah masuk tersimpan di sessionStorage."));

  const [query] = useState(() => new URLSearchParams(window.location.search));
  const next = safeNextPath(query.get("next"));
  const [pending, setPending] = useState<PendingCode | null>(readPending);
  const [step, setStep] = useState<Step>(pending ? "code" : "email");
  const [email, setEmail] = useState(pending?.email ?? "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(() => {
    const error = query.get("error");
    return error && googleErrors[error] ? { tone: "error", text: googleErrors[error] } : null;
  });
  const secondsUntilResend = useSecondsUntil(pending?.resendAt);

  function storePending(value: PendingCode | null) {
    setPending(value);
    if (value) {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } else {
      sessionStorage.removeItem(storageKey);
    }
  }

  async function requestCode(targetEmail: string, mode: "send" | "resend") {
    const showError = mode === "send" ? setEmailError : setCodeError;
    setBusy(mode);
    setNotice(null);
    showError(null);

    try {
      const { data, error } = await browserApi.POST("/auth/code", { body: { email: targetEmail } });
      if (!data) {
        showError(messageOf(error, "email"));
        return;
      }

      const now = Date.now();
      storePending({
        email: data.email,
        resendAt: now + data.secondsUntilResend * 1000,
        expiresAt: now + data.expiresInSeconds * 1000,
      });
      setEmail(data.email);
      if (mode === "send") {
        setStep("code");
        setCode("");
        setCodeError(null);
      }
      if (!data.sent) {
        setNotice({ tone: "success", text: "Kode sudah kami kirim beberapa saat lalu. Cek kotak masuk atau folder spam Anda." });
      } else if (mode === "resend") {
        setNotice({ tone: "success", text: `Kode baru sudah dikirim ke ${data.email}.` });
      }
    } catch {
      showError(connectionErrorMessage);
    } finally {
      setBusy(null);
    }
  }

  async function verifyCode(digits: string) {
    if (!pending || busy) {
      return;
    }
    setBusy("verify");
    setCodeError(null);
    setNotice(null);

    try {
      const { data, error } = await browserApi.POST("/auth/code/verify", {
        body: { email: pending.email, code: digits, remember },
      });
      if (data) {
        sessionStorage.removeItem(storageKey);
        // A full navigation lets the server render the next page with the new session cookie.
        window.location.assign(next);
        return;
      }

      setCodeError(messageOf(error, "code"));
      setCode("");
      const reason = error?.error.code;
      if (reason === "code_expired" || reason === "too_many_attempts") {
        storePending({ ...pending, resendAt: Date.now() });
      }
    } catch {
      setCodeError(connectionErrorMessage);
    }
    setBusy(null);
  }

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      setEmailError("Masukkan alamat email Anda.");
      return;
    }
    void requestCode(email, "send");
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length !== 6) {
      setCodeError("Masukkan 6 digit kode dari email.");
      return;
    }
    void verifyCode(code);
  }

  function changeCode(digits: string) {
    setCode(digits);
    setCodeError(null);
    if (digits.length === 6) {
      void verifyCode(digits);
    }
  }

  function changeEmail() {
    storePending(null);
    setStep("email");
    setCode("");
    setCodeError(null);
    setNotice(null);
  }

  if (step === "code" && pending) {
    return (
      <div className={styles.column}>
        <Stepper step="code" />
        <div className={styles.heading}>
          <h1 className={styles.title}>Cek email Anda</h1>
          <p className={styles.lead}>
            Kode 6 digit sudah dikirim ke <strong>{pending.email}</strong>.{" "}
            <button type="button" className={styles.textButton} onClick={changeEmail}>
              Ganti email
            </button>
          </p>
        </div>

        {notice && <NoticeBanner notice={notice} />}

        <form className={styles.form} onSubmit={submitCode} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="code">
              Kode verifikasi
            </label>
            <OtpInput
              value={code}
              onChange={changeCode}
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
            <span>Belum menerima kode?</span>
            {secondsUntilResend > 0 ? (
              <span className={styles.resendWait}>
                Kirim ulang dalam <span className={styles.countdown}>{formatSeconds(secondsUntilResend)}</span>
              </span>
            ) : (
              <button
                type="button"
                className={styles.textButton}
                disabled={busy !== null}
                onClick={() => void requestCode(pending.email, "resend")}
              >
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
      email={email}
      onEmailChange={(value) => {
        setEmail(value);
        setEmailError(null);
      }}
      emailError={emailError}
      busy={busy === "send"}
      onSubmit={submitEmail}
      next={next}
      notice={notice}
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
      <Stepper step="email" />
      <div className={styles.heading}>
        <h1 className={styles.title}>{text.title}</h1>
        <p className={styles.lead}>{text.lead}</p>
      </div>

      {notice && <NoticeBanner notice={notice} />}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Email
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

      <div className={styles.divider}>atau</div>

      <a className={styles.google} href={`/api/v1/auth/google?next=${encodeURIComponent(next)}`}>
        <GoogleIcon />
        {text.google}
      </a>

      <p className={styles.legal}>
        {text.legal}, Anda menyetujui <strong>Syarat Layanan</strong> dan <strong>Kebijakan Privasi</strong> JD Sign.
      </p>
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const onCode = step === "code";

  return (
    <ol className={styles.stepper} aria-label="Langkah masuk">
      <li className={`${styles.step} ${onCode ? styles.stepDone : styles.stepActive}`} aria-current={onCode ? undefined : "step"}>
        <span className={styles.stepDot}>{onCode ? <CheckMark /> : "1"}</span>
        Email
      </li>
      <li aria-hidden="true" className={`${styles.stepConnector} ${onCode ? styles.stepConnectorDone : ""}`} />
      <li className={`${styles.step} ${onCode ? styles.stepActive : ""}`} aria-current={onCode ? "step" : undefined}>
        <span className={styles.stepDot}>2</span>
        Kode verifikasi
      </li>
    </ol>
  );
}

function CheckMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-label="selesai">
      <path d="M2 7.5 5.5 11 12 3.5" />
    </svg>
  );
}

function SubmitButton({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button type="submit" className={styles.primary} disabled={busy} aria-busy={busy}>
      <span>{busy ? busyLabel : label}</span>
      <span className={styles.arrowBadge}>{busy ? <span className={styles.spinner} /> : <ArrowRightIcon />}</span>
    </button>
  );
}

function NoticeBanner({ notice }: { notice: Notice }) {
  return (
    <p
      className={`${styles.notice} ${notice.tone === "error" ? styles.noticeError : styles.noticeSuccess}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      {notice.text}
    </p>
  );
}

function readPending(): PendingCode | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as PendingCode | null;
    if (stored && typeof stored.email === "string" && stored.expiresAt > Date.now()) {
      return stored;
    }
  } catch {
    // A corrupt entry is treated like no entry.
  }
  sessionStorage.removeItem(storageKey);

  return null;
}

function messageOf(error: ApiError | undefined, field: "email" | "code"): string {
  return error?.error.fields?.[field] ?? error?.error.message ?? "Terjadi kesalahan. Silakan coba lagi.";
}

const subscribeToClock = (onTick: () => void) => {
  const timer = window.setInterval(onTick, 250);
  return () => window.clearInterval(timer);
};

/** Whole seconds until `target` (a Date.now() timestamp), rounded up and ticking while mounted. */
function useSecondsUntil(target: number | undefined): number {
  return useSyncExternalStore(
    subscribeToClock,
    () => (target ? Math.max(0, Math.ceil((target - Date.now()) / 1000)) : 0),
    () => 0,
  );
}

function formatSeconds(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
