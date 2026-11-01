import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import {
  ADMIN_HOME,
  ADMIN_LOGIN,
  ADMIN_RESET_PASSWORD,
  decideAdminRoute,
  isSupabaseAuthCookie,
} from "@/lib/auth-routes";
import { CRM_APP_HEADER, toCrmTreePath } from "@/lib/crm/host";
import { CRM_HOME, CRM_LOGIN, decideCrmRoute } from "@/lib/crm/auth-routes";
import { getSupabaseEnv } from "./env";

type Surface = "admin" | "crm";

/**
 * Refreshes the Supabase session cookies and applies the first, cheap layer
 * of protection for one surface: the website admin (/admin/*) or the CRM host.
 * Every page, server action and route handler re-checks authorisation against
 * the database; this is not the only guard.
 *
 * For the CRM the (valid) request is rewritten to the internal /crm tree.
 */
export async function updateSession(request: NextRequest, surface: Surface = "admin") {
  const crm = surface === "crm";
  const login = crm ? CRM_LOGIN : ADMIN_LOGIN;
  const home = crm ? CRM_HOME : ADMIN_HOME;

  /** The response that lets the request continue: as is for /admin, rewritten into the /crm tree for the CRM host. */
  const proceed = () => {
    if (!crm) return NextResponse.next({ request });
    const headers = new Headers(request.headers);
    headers.set(CRM_APP_HEADER, "1");
    const target = request.nextUrl.clone();
    target.pathname = toCrmTreePath(request.nextUrl.pathname);
    return NextResponse.rewrite(target, { request: { headers } });
  };

  let response = proceed();
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = proceed();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Responses that set auth cookies must never be cached by a CDN
        // (otherwise one visitor's session could be served to another).
        for (const [key, header] of Object.entries(headers ?? {})) response.headers.set(key, header);
      },
    },
  });

  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    // Carry refreshed/cleared session cookies and their cache headers onto the redirect.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    for (const [key, header] of response.headers) {
      if (key.toLowerCase() === "cache-control" || key.toLowerCase() === "pragma" || key.toLowerCase() === "expires") {
        redirect.headers.set(key, header);
      }
    }
    return redirect;
  };

  // Password-recovery email link (website admin only): exchange the one-time code for a session
  // (PKCE), then continue to the page without the code in the URL.
  const { pathname, searchParams } = request.nextUrl;
  const recoveryCode = searchParams.get("code");
  if (!crm && pathname === ADMIN_RESET_PASSWORD && recoveryCode) {
    const { error } = await supabase.auth.exchangeCodeForSession(recoveryCode);
    return redirectTo(error ? `${ADMIN_RESET_PASSWORD}?error=invalid` : ADMIN_RESET_PASSWORD);
  }

  // Verifies the JWT and refreshes it when needed. Don't run code between
  // client creation and this call.
  const { data, error } = await supabase.auth.getClaims();
  const hasSession = Boolean(data?.claims?.sub);

  // Stale or unverifiable auth cookies can never recover: remove them so the
  // visitor gets a clean login page instead of a failing session. A transient
  // network error says nothing about the cookies, so those are left alone.
  if (!hasSession && error?.name !== "AuthRetryableFetchError") {
    for (const { name } of request.cookies.getAll()) {
      if (isSupabaseAuthCookie(name)) response.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
  }

  const decision = crm ? decideCrmRoute(pathname, hasSession) : decideAdminRoute(pathname, hasSession);

  if (decision === "to-login") return redirectTo(login);

  if (decision === "check-admin-then-home") {
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (isAdmin === true) return redirectTo(home);
  }

  return response;
}
