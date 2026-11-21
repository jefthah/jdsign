"use client";

import { useState, type FormEvent } from "react";

import { useLogout } from "@/components/account/use-logout";
import { styles } from "@/components/auth/auth-styles";
import { ArrowRightIcon } from "@/components/auth/icons";
import { OtpInput } from "@/components/auth/otp-input";
import { browserApi, connectionErrorMessage, type ApiError } from "@/lib/api/browser";
import { adminLoginHref, adminSetupPath, adminStepHref, adminVerifyPath, safeAdminNextPath } from "@/lib/auth/admin-paths";

type Mode = "setup" | "verify";

/**
 * Six-digit authenticator code. "setup" confirms a new authenticator, "verify"
 * unlocks the admin area for this session. Six digits submit on their own.
 */
export function AuthenticatorForm({ mode }: { mode: Mode }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(digits: string) {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const body = { code: digits };
      const { error: failure, response } =
        mode === "setup"
          ? await browserApi.POST("/admin/mfa/setup", { body })
          : await browserApi.POST("/admin/mfa/verify", { body });
      if (response.ok) {
        // A full navigation lets the server render the admin page with the verified session.
        window.location.assign(safeAdminNextPath(new URLSearchParams(window.location.search).get("next")));
        return;
      }

      const destination = redirectFor(response.status, failure);
      if (destination) {
        window.location.assign(destination);
        return;
      }
      setError(failure?.error.fields?.code ?? failure?.error.message ?? "Terjadi kesalahan. Silakan coba lagi.");
      setCode("");
    } catch {
      setError(connectionErrorMessage);
    }
    setBusy(false);
  }

  function changeCode(digits: string) {
    setCode(digits);
    setError(null);
    if (digits.length === 6) {
      void submit(digits);
    }
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length !== 6) {
      setError("Masukkan 6 digit kode dari aplikasi authenticator.");
      return;
    }
    void submit(code);
  }

  return (
    <form className={styles.form} onSubmit={submitForm} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="code">
          {mode === "setup" ? "Kode dari aplikasi" : "Kode authenticator"}
        </label>
        <OtpInput
          value={code}
          onChange={changeCode}
          invalid={error !== null}
          busy={busy}
          describedBy={error ? "code-error" : "code-hint"}
          label="Kode authenticator 6 digit"
          autoFocus={mode === "verify"}
        />
        {error ? (
          <p id="code-error" className={styles.error} role="alert">
            {error}
          </p>
        ) : (
          <p id="code-hint" className={styles.hint}>
            {mode === "setup"
              ? "Kode di aplikasi berganti setiap 30 detik."
              : "Kode berganti setiap 30 detik. Pakai kode yang sedang tampil."}
          </p>
        )}
      </div>

      <button type="submit" className={styles.primary} disabled={busy} aria-busy={busy}>
        {busy && <span className={styles.spinner} aria-hidden="true" />}
        <span>{busy ? "Memeriksa kode…" : mode === "setup" ? "Aktifkan dan buka panel admin" : "Buka panel admin"}</span>
        {!busy && <ArrowRightIcon />}
      </button>
    </form>
  );
}

/** Ends the session from the authenticator pages, for an admin who cannot enter a code. */
export function SignOutButton() {
  const { busy, logout } = useLogout();

  return (
    <button type="button" className={styles.textButton} onClick={logout} disabled={busy}>
      {busy ? "Keluar…" : "Keluar"}
    </button>
  );
}

/** Pages to move to when the code was refused because of the account's state, not the code. */
function redirectFor(status: number, failure: ApiError | undefined): string | null {
  const next = new URLSearchParams(window.location.search).get("next");
  switch (true) {
    case status === 401:
      return adminLoginHref(next);
    case failure?.error.code === "mfa_setup_required":
      return adminStepHref(adminSetupPath, next);
    case failure?.error.code === "mfa_already_enabled":
      return adminStepHref(adminVerifyPath, next);
    default:
      return null;
  }
}
