/**
 * Pure routing rules for /admin, shared by the proxy and unit tests.
 * Authorisation is NOT decided here: this only separates "has a session"
 * from "doesn't". Admin membership is verified server-side against the
 * `admin_users` table in every page and server action.
 */

export const ADMIN_HOME = "/admin";
export const ADMIN_LOGIN = "/admin/login";
export const ADMIN_FORGOT_PASSWORD = "/admin/forgot-password";
export const ADMIN_RESET_PASSWORD = "/admin/reset-password";

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_HOME || pathname.startsWith(`${ADMIN_HOME}/`);
}

export function isLoginPath(pathname: string): boolean {
  return pathname === ADMIN_LOGIN || pathname.startsWith(`${ADMIN_LOGIN}/`);
}

/** Recovery pages are reachable without a session (the reset page checks for one itself). */
export function isRecoveryPath(pathname: string): boolean {
  return [ADMIN_FORGOT_PASSWORD, ADMIN_RESET_PASSWORD].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export type AdminRouteDecision = "allow" | "to-login" | "check-admin-then-home";

export function decideAdminRoute(pathname: string, hasSession: boolean): AdminRouteDecision {
  if (!isAdminPath(pathname)) return "allow";
  if (isRecoveryPath(pathname)) return "allow";
  if (isLoginPath(pathname)) return hasSession ? "check-admin-then-home" : "allow";
  return hasSession ? "allow" : "to-login";
}

/**
 * Supabase session cookies: `sb-<ref>-auth-token`, optionally chunked (`.0`, `.1`).
 * Deliberately excludes the PKCE code verifier, which a pending recovery needs.
 */
export function isSupabaseAuthCookie(name: string): boolean {
  return /^sb-.+-auth-token(\.\d+)?$/.test(name);
}
