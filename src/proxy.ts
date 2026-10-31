import { NextResponse, type NextRequest } from "next/server";
import { isAdminPath } from "@/lib/auth-routes";
import { LOCALE_COOKIE } from "@/i18n/config";
import { decideLocaleRoute } from "@/i18n/routing";
import { getPreviewConfig } from "@/lib/preview/config";
import { GATEWAY_PREFIX } from "@/lib/preview/gateway";
import { parsePreviewHost } from "@/lib/preview/hostname";
import { updateSession } from "@/lib/supabase/proxy";

/** Paths the locale router never touches (API, Next internals, OG routes, anything with a file extension). */
const SKIPS_LOCALE_ROUTING = /^\/(api|_next|_vercel|og)(\/|$)|\./;

/**
 * 1. Preview hosts (<name>.<base domain>): EVERY path, including /api, /_next and files, belongs to the
 *    client's site, so it is handed to the preview gateway (an internal route) before anything else.
 * 2. /admin/*: Supabase session refresh + route guard (never localized).
 * 3. Public pages: locale routing. Dutch has no prefix and is rewritten to /nl;
 *    English lives under /en; /nl/* redirects to the bare path.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const config = getPreviewConfig();
  const previewSubdomain = parsePreviewHost(request.headers.get("host"), {
    baseDomain: config.baseDomain,
    allowLocalhost: config.allowLocalhost,
  });
  if (previewSubdomain) {
    const url = request.nextUrl.clone();
    url.pathname = `${GATEWAY_PREFIX}${pathname === "/" ? "" : pathname}`;
    url.search = search;
    return NextResponse.rewrite(url);
  }
  // A dedicated gateway deployment answers nothing but preview hosts.
  if (config.gatewayOnly) return new NextResponse("Not found", { status: 404 });

  if (isAdminPath(pathname)) return updateSession(request);

  // The preview-host matcher below also runs for hosts that aren't previews: those must behave exactly as before.
  if (SKIPS_LOCALE_ROUTING.test(pathname)) return NextResponse.next();

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
  matcher: [
    // The main site: everything except API routes, Next internals, OG image routes and files with an extension.
    "/((?!api/|_next/|_vercel/|og/|.*\\..*).*)",
    // Preview hosts (<name>.ianverlinden.com, <name>.localhost in dev): every path. www and the apex are excluded.
    // Literal on purpose: matcher values must be static. Keep in sync with PREVIEW_BASE_DOMAIN (a test checks next.config too).
    { source: "/:path*", has: [{ type: "host", value: "(?!www\\.)[a-z0-9-]+\\.(ianverlinden\\.com|localhost)" }] },
  ],
};
