/**
 * Pure routing rules for the CRM host (visible URLs, without the internal /crm prefix). Like the admin rules, this only separates
 * "has a session" from "doesn't": authorisation (membership in `admin_users`) is verified on the server for every page,
 * server action and route handler.
 *
 * The CRM has its own login and its own, host-only session cookies: signing in at crm.ianverlinden.com does not sign you in
 * at ianverlinden.com/admin (and vice versa). Password recovery stays at the website admin (/admin/forgot-password).
 */
export const CRM_HOME = "/";
export const CRM_LOGIN = "/login";

export function isCrmLoginPath(pathname: string): boolean {
  return pathname === CRM_LOGIN || pathname.startsWith(`${CRM_LOGIN}/`);
}

export type CrmRouteDecision = "allow" | "to-login" | "check-admin-then-home";

export function decideCrmRoute(pathname: string, hasSession: boolean): CrmRouteDecision {
  if (isCrmLoginPath(pathname)) return hasSession ? "check-admin-then-home" : "allow";
  return hasSession ? "allow" : "to-login";
}
