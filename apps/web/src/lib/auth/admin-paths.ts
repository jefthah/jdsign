export const adminHomePath = "/admin";
export const adminVerifyPath = "/admin/mfa";
export const adminSetupPath = "/admin/mfa/setup";

/**
 * Where to go after the authenticator check: an admin page, never the MFA
 * pages themselves or anything outside /admin.
 */
export function safeAdminNextPath(value: string | null | undefined): string {
  if (
    !value ||
    value.length > 500 ||
    !(value === adminHomePath || value.startsWith(`${adminHomePath}/`) || value.startsWith(`${adminHomePath}?`)) ||
    value.startsWith(adminVerifyPath) ||
    /[\\\s]/.test(value)
  ) {
    return adminHomePath;
  }

  return value;
}
