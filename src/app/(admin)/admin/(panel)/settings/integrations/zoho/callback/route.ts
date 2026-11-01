import { NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth";
import { getZohoConfig } from "@/lib/mail/zoho/config";
import { verifyOAuthState } from "@/lib/mail/zoho/crypto";
import { ZohoError } from "@/lib/mail/zoho/oauth";
import { completeConnection } from "@/lib/mail/zoho/service";

const STATE_COOKIE = "zoho_oauth_state";

/**
 * Zoho redirects back here with ?code=…&state=…. The state must match the signed cookie set when this admin started
 * the flow; anything else (CSRF, a replay, another user, an expired attempt) is refused before the code is used.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`/admin/settings/integrations?${query}`, request.url));
    res.cookies.set(STATE_COOKIE, "", { path: "/admin/settings/integrations/zoho", maxAge: 0 });
    return res;
  };

  const admin = await getAdminContext();
  if (!admin) return NextResponse.redirect(new URL("/admin/login", request.url));

  const config = getZohoConfig();
  if (!config.enabled || !config.encryptionKey) return done("zoho_error=not_enabled");

  const cookie = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1);
  const check = verifyOAuthState(cookie, url.searchParams.get("state"), admin.userId, config.encryptionKey);
  if (!check.ok) return done(`zoho_error=state_${check.reason}`);

  // The user declined, or Zoho reported a problem.
  if (url.searchParams.get("error")) return done("zoho_error=denied");
  const code = url.searchParams.get("code");
  if (!code) return done("zoho_error=no_code");

  try {
    await completeConnection(config, code);
    return done("zoho=connected");
  } catch (error) {
    console.error("[zoho] connect failed:", error instanceof ZohoError ? `${error.kind} ${error.status ?? ""}` : "unexpected");
    return done(`zoho_error=${error instanceof ZohoError ? error.kind : "failed"}`);
  }
}
