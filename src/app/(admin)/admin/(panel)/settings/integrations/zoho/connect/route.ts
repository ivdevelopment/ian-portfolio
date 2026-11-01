import { NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth";
import { getZohoConfig } from "@/lib/mail/zoho/config";
import { createOAuthState } from "@/lib/mail/zoho/crypto";
import { buildAuthorizationUrl } from "@/lib/mail/zoho/oauth";

const STATE_COOKIE = "zoho_oauth_state";

/** Starts the Zoho authorisation. Admin only; refuses to run unless the integration is enabled and fully configured. */
export async function GET(request: Request) {
  const admin = await getAdminContext();
  if (!admin) return NextResponse.redirect(new URL("/admin/login", request.url));

  const config = getZohoConfig();
  const back = (error: string) => NextResponse.redirect(new URL(`/admin/settings/integrations?zoho_error=${error}`, request.url));
  if (!config.enabled || !config.encryptionKey) return back("not_enabled");

  const { state, cookie } = createOAuthState(admin.userId, config.encryptionKey);
  const response = NextResponse.redirect(buildAuthorizationUrl(config, state));
  // The cookie is the other half of the CSRF check: only this browser, this admin and a 10-minute window can finish the flow.
  response.cookies.set(STATE_COOKIE, cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/admin/settings/integrations/zoho", maxAge: 600 });
  return response;
}
