"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";

import { browserApi, connectionErrorMessage, type ApiError } from "@/lib/api/browser";
import type { components } from "@/lib/api/schema";

export type Account = components["schemas"]["Account"];
export type Busy = "send" | "verify" | "resend" | null;
export type Notice = { tone: "error" | "success"; text: string };
type PendingCode = { email: string; resendAt: number; expiresAt: number };

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
 * The notice for a failed Google sign-in: the API's callback returns to the
 * page it started from (/login or /admin/login) with ?error=<code>.
 */
export function googleErrorNotice(code: string | null): Notice | null {
  return code && googleErrors[code] ? { tone: "error", text: googleErrors[code] } : null;
}

/**
 * The email → code sign-in steps, shared by /login, /register and /admin/login.
 * The pending code survives a page refresh in sessionStorage under
 * `storageKey`, so the hook must run in the browser only.
 */
export function useEmailCode({
  storageKey,
  remember,
  initialNotice = null,
  onSignedIn,
}: {
  storageKey: string;
  /** Sent with the code: true keeps the session after the browser closes. */
  remember: boolean;
  initialNotice?: Notice | null;
  /** Runs once the session cookie is set; the stored pending code is already cleared. */
  onSignedIn: (account: Account) => void;
}) {
  const [pending, setPending] = useState(() => readPending(storageKey));
  const [step, setStep] = useState<"email" | "code">(pending ? "code" : "email");
  const [email, setEmail] = useState(pending?.email ?? "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(initialNotice);
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
        // Busy stays on: the caller usually navigates away from here.
        onSignedIn(data);
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

  return {
    step: step === "code" && pending ? ("code" as const) : ("email" as const),
    pendingEmail: pending?.email ?? "",
    email,
    emailError,
    code,
    codeError,
    busy,
    notice,
    secondsUntilResend,
    typeEmail(value: string) {
      setEmail(value);
      setEmailError(null);
    },
    submitEmail(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!email.trim()) {
        setEmailError("Masukkan alamat email Anda.");
        return;
      }
      void requestCode(email, "send");
    },
    submitCode(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (code.length !== 6) {
        setCodeError("Masukkan 6 digit kode dari email.");
        return;
      }
      void verifyCode(code);
    },
    /** Six digits submit on their own. */
    changeCode(digits: string) {
      setCode(digits);
      setCodeError(null);
      if (digits.length === 6) {
        void verifyCode(digits);
      }
    },
    resendCode() {
      if (pending) {
        void requestCode(pending.email, "resend");
      }
    },
    /** Back to the email step, forgetting the pending code. */
    changeEmail() {
      storePending(null);
      setStep("email");
      setCode("");
      setCodeError(null);
      setNotice(null);
    },
  };
}

function readPending(storageKey: string): PendingCode | null {
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

export function formatSeconds(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
