import Link from "next/link";
import type { ReactNode } from "react";

import { ShieldIcon } from "@/components/account/icons";
import { Wordmark } from "@/components/auth/auth-shell";
import { CheckIcon } from "@/components/auth/icons";

import "./admin-auth.css";

/** The topbar link out of the admin sign-in pages. */
export type ExitLink = { href: string; label: string; prompt?: string };

export const buyerExit: ExitLink = { href: "/login", label: "Masuk sebagai pembeli", prompt: "Bukan admin?" };
export const siteExit: ExitLink = { href: "/", label: "Kembali ke situs" };

const assurances = ["Kode authenticator di setiap sesi", "Terkunci lagi setelah 1 jam tanpa aktivitas"];

/**
 * Dark frame for the admin sign-in steps: /admin/login, /admin/mfa and
 * /admin/mfa/setup. It sets its own --auth-* tokens, so the shared auth
 * pieces (OTP field, buttons, notices) render dark inside it.
 */
export function AdminAuthShell({ exit, children }: { exit: ExitLink; children: ReactNode }) {
  return (
    <div className="adm-auth">
      <header className="adm-auth-topbar">
        <div className="adm-auth-brand">
          <Wordmark />
          <span className="adm-auth-pill">
            <span className="adm-auth-dot" aria-hidden="true" />
            PANEL ADMIN
          </span>
        </div>
        <p className="adm-auth-exit">
          {exit.prompt && <span className="adm-auth-exit-prompt">{exit.prompt}</span>}
          <Link className="adm-auth-exit-link" href={exit.href}>
            {exit.label}
          </Link>
        </p>
      </header>

      <main className="adm-auth-main">{children}</main>

      <footer className="adm-auth-bottombar">
        <span>© 2026 JD Sign · Area terbatas untuk pengelola</span>
        <ul className="adm-auth-assurances" aria-label="Pengamanan panel admin">
          {assurances.map((assurance) => (
            <li key={assurance}>
              <span className="adm-auth-dot" aria-hidden="true" />
              {assurance}
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
}

export type AdminStep = 1 | 2 | 3;

const steps: { step: AdminStep; label: string }[] = [
  { step: 1, label: "Email" },
  { step: 2, label: "Kode email" },
  { step: 3, label: "Authenticator" },
];

/**
 * The sign-in card: shield, the three-step progress (left out when `step` is
 * undefined), the heading, then the step's own content.
 */
export function AdminAuthCard({
  step,
  title,
  lead,
  children,
}: {
  step?: AdminStep;
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="adm-auth-card" aria-labelledby="admin-auth-title">
      <div className="adm-auth-head">
        <div className="adm-auth-head-row">
          <span className="adm-auth-shield" aria-hidden="true">
            <ShieldIcon size={24} />
          </span>
          {step && <AdminStepper current={step} />}
        </div>
        <div className="adm-auth-heading">
          <h1 id="admin-auth-title" className="adm-auth-title">
            {title}
          </h1>
          <p className="adm-auth-lead">{lead}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function AdminStepper({ current }: { current: AdminStep }) {
  return (
    <ol className="adm-auth-steps" aria-label={`Langkah ${current} dari ${steps.length}`}>
      {steps.map(({ step, label }) => {
        const state = step < current ? "done" : step === current ? "current" : "upcoming";

        return (
          <li
            key={step}
            className="adm-auth-step"
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="adm-auth-step-circle">{state === "done" ? <CheckIcon size={11} /> : step}</span>
            <span className="adm-auth-step-label">
              {label}
              {state === "done" && <span className="adm-auth-sr"> (selesai)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Placeholder card while the server checks the session. */
export function AdminAuthSkeleton() {
  return <span className="adm-auth-skeleton" aria-label="Memuat halaman admin" />;
}
