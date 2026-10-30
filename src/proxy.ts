import { NextResponse, type NextRequest } from "next/server";
import { isAdminPath } from "@/lib/auth-routes";
import { LOCALE_COOKIE } from "@/i18n/config";
import { decideLocaleRoute } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * - /admin/*: Supabase session refresh + route guard (never localized).
 * - public pages: locale routing. Dutch has no prefix and is rewritten to /nl;
 *   English lives under /en; /nl/* redirects to the bare path.
 * - /api/*, /_next, /og/* and files with an extension are not handled here.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isAdminPath(pathname)) return updateSession(request);

  const decision = decideLocaleRoute(pathname, search, request.cookies.get(LOCALE_COOKIE)?.value);
  if (decision.type === "next") return NextResponse.next();

  const url = request.nextUrl.clone();
  const [target, query = ""] = decision.path.split("?");
  url.pathname = target;
  url.search = query ? `?${query}` : "";

  if (decision.type === "rewrite") return NextResponse.rewrite(url);

  const response = NextResponse.redirect(url, decision.status);
  if (decision.noStore) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  // Everything except API routes, Next internals, OG image routes and files with an extension.
  matcher: ["/((?!api/|_next/|_vercel/|og/|.*\\..*).*)"],
};
