import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { ADMIN_HOME, ADMIN_LOGIN, decideAdminRoute } from "@/lib/auth-routes";
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
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Verifies the JWT and refreshes it when needed. Don't run code between
  // client creation and this call.
  const { data } = await supabase.auth.getClaims();
  const hasSession = Boolean(data?.claims?.sub);
  const decision = decideAdminRoute(request.nextUrl.pathname, hasSession);

  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    // Carry any refreshed session cookies onto the redirect.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (decision === "to-login") return redirectTo(ADMIN_LOGIN);

  if (decision === "check-admin-then-home") {
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (isAdmin === true) return redirectTo(ADMIN_HOME);
  }

  return response;
}
