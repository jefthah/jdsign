export const defaultNextPath = "/account";

/**
 * Keeps post-login redirects on this site. Anything that is not a plain
 * absolute path (such as "//evil.example") falls back to the account page.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (
    !value ||
    value.length > 500 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\s]/.test(value)
  ) {
    return defaultNextPath;
  }

  return value;
}
