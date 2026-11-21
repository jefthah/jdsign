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

/** The admin sign-in page, returning to `next` (an admin page) afterwards. */
export function adminLoginHref(next: string): string {
  const destination = safeAdminNextPath(next);

  return destination === adminHomePath ? adminLoginPath : `${adminLoginPath}?next=${encodeURIComponent(destination)}`;
}
