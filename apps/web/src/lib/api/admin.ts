import { notFound, redirect } from "next/navigation";

import { adminHomePath, adminSetupPath, adminVerifyPath } from "@/lib/auth/admin-paths";

import type { components } from "./schema";
import { serverApi } from "./server";
import { sessionCookieHeader } from "./session";

export type AdminOverview = components["schemas"]["AdminOverview"];
export type AdminMfaSetup = components["schemas"]["AdminMfaSetup"];
export type SetupState = { kind: "ready"; setup: AdminMfaSetup } | { kind: "unavailable"; message: string };

/**
 * Sends the visitor to the step the API asked for: sign in, set up the
 * authenticator, or enter a code. Visitors who are not admins get a 404 so the
 * admin area does not announce itself.
 */
function leaveAdminArea(status: number, code: string | undefined, path: string): never {
  if (status === 401) {
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  if (code === "mfa_setup_required") {
    redirect(adminSetupPath);
  }
  if (code === "mfa_required") {
    redirect(`${adminVerifyPath}?next=${encodeURIComponent(path)}`);
  }

  notFound();
}

async function sessionOrLogin(path: string): Promise<{ cookie: string }> {
  const headers = await sessionCookieHeader();
  if (!headers) {
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }

  return headers;
}

/** Overview counts for a verified admin; everyone else is redirected. Render inside <Suspense>. */
export async function requireAdminOverview(path = adminHomePath): Promise<AdminOverview> {
  const { data, error, response } = await serverApi.GET("/admin/overview", {
    headers: await sessionOrLogin(path),
    signal: AbortSignal.timeout(3000),
  });
  if (data) {
    return data;
  }

  leaveAdminArea(response.status, error?.error.code, path);
}

/**
 * For the code page: returns while this session still needs a code, and
 * redirects when it is signed out, not an admin, already verified, or has no
 * authenticator yet. Render inside <Suspense>.
 */
export async function requireAdminAwaitingCode(): Promise<void> {
  const { data, error, response } = await serverApi.GET("/admin/overview", {
    headers: await sessionOrLogin(adminHomePath),
    signal: AbortSignal.timeout(3000),
  });
  if (data) {
    redirect(adminHomePath);
  }
  if (error?.error.code === "mfa_required") {
    return;
  }

  leaveAdminArea(response.status, error?.error.code, adminHomePath);
}

/**
 * The secret and QR contents for an admin without a confirmed authenticator.
 * Admins who already have one go to the code page. Render inside <Suspense>.
 */
export async function requireAdminSetup(): Promise<SetupState> {
  const { data, error, response } = await serverApi.GET("/admin/mfa/setup", {
    headers: await sessionOrLogin(adminHomePath),
    signal: AbortSignal.timeout(3000),
  });
  if (data) {
    return { kind: "ready", setup: data };
  }
  if (response.status === 409) {
    redirect(adminVerifyPath);
  }
  if (response.status === 503 && error) {
    return { kind: "unavailable", message: error.error.message };
  }

  leaveAdminArea(response.status, error?.error.code, adminHomePath);
}
