/**
 * Pure routing rules for /admin, shared by the proxy and unit tests.
 * Authorisation is NOT decided here: this only separates "has a session"
 * from "doesn't". Admin membership is verified server-side against the
 * `admin_users` table in every page and server action.
 */

export const ADMIN_HOME = "/admin";
export const ADMIN_LOGIN = "/admin/login";

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_HOME || pathname.startsWith(`${ADMIN_HOME}/`);
}

export function isLoginPath(pathname: string): boolean {
  return pathname === ADMIN_LOGIN || pathname.startsWith(`${ADMIN_LOGIN}/`);
}

export type AdminRouteDecision = "allow" | "to-login" | "check-admin-then-home";

export function decideAdminRoute(pathname: string, hasSession: boolean): AdminRouteDecision {
  if (!isAdminPath(pathname)) return "allow";
  if (isLoginPath(pathname)) return hasSession ? "check-admin-then-home" : "allow";
  return hasSession ? "allow" : "to-login";
}
