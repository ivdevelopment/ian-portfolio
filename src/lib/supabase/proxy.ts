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
import { getSupabaseEnv } from "./env";

/**
 * Refreshes the Supabase session cookies and applies the first, cheap layer
 * of /admin protection. Every admin page and server action re-checks
 * authorisation against the database; this is not the only guard.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
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

  // Password-recovery email link: exchange the one-time code for a session
  // (PKCE), then continue to the page without the code in the URL.
  const { pathname, searchParams } = request.nextUrl;
  const recoveryCode = searchParams.get("code");
  if (pathname === ADMIN_RESET_PASSWORD && recoveryCode) {
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

  const decision = decideAdminRoute(pathname, hasSession);

  if (decision === "to-login") return redirectTo(ADMIN_LOGIN);

  if (decision === "check-admin-then-home") {
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (isAdmin === true) return redirectTo(ADMIN_HOME);
  }

  return response;
}
