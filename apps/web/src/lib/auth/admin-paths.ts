export const adminHomePath = "/admin";
export const adminLoginPath = "/admin/login";
export const adminVerifyPath = "/admin/mfa";
export const adminSetupPath = "/admin/mfa/setup";

/**
 * Where to go after signing in to the admin panel: an admin page, never the
 * sign-in or MFA pages themselves or anything outside /admin.
 */
export function safeAdminNextPath(value: string | null | undefined): string {
  if (
    !value ||
    value.length > 500 ||
    !(value === adminHomePath || value.startsWith(`${adminHomePath}/`) || value.startsWith(`${adminHomePath}?`)) ||
    value.startsWith(adminVerifyPath) ||
    value.startsWith(adminLoginPath) ||
    /[\\\s]/.test(value)
  ) {
    return adminHomePath;
  }

  return value;
}

/**
 * A sign-in step (sign-in page, authenticator code or setup) that returns to
 * `next`, an admin page, once the admin is through.
 */
export function adminStepHref(step: string, next: string | null | undefined): string {
  const destination = safeAdminNextPath(next);

  return destination === adminHomePath ? step : `${step}?next=${encodeURIComponent(destination)}`;
}

/** The checked `next` search parameter of an admin sign-in page. */
export function adminNextParam(value: string | string[] | undefined): string {
  return safeAdminNextPath(Array.isArray(value) ? value[0] : value);
}

/** The admin sign-in page, returning to `next` (an admin page) afterwards. */
export function adminLoginHref(next: string | null | undefined): string {
  return adminStepHref(adminLoginPath, next);
}
