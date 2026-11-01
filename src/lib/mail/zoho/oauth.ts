import { ZOHO_READ_SCOPES, type ZohoConfig } from "./config";

export type Fetch = typeof fetch;

export class ZohoError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth" | "rate_limit" | "provider" | "bad_response" | "network",
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Authorization URL (server-based application, authorization-code flow). `access_type=offline` is what yields a refresh token. */
export function buildAuthorizationUrl(config: Pick<ZohoConfig, "accountsUrl" | "clientId" | "redirectUri">, state: string): string {
  const url = new URL(`${config.accountsUrl}/oauth/v2/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", ZOHO_READ_SCOPES.join(","));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export type TokenResponse = { accessToken: string; refreshToken: string | null; expiresInSec: number; scope: string; apiDomain: string | null };

async function postToken(config: ZohoConfig, form: Record<string, string>, fetchImpl: Fetch): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.accountsUrl}/oauth/v2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...form }),
      cache: "no-store",
    });
  } catch {
    throw new ZohoError("Could not reach Zoho.", "network");
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  // Zoho answers 200 with {"error": "..."} for most OAuth failures.
  if (!body || typeof body.error === "string" || !res.ok) {
    const error = typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new ZohoError(`Zoho refused the request (${error}).`, error === "invalid_code" || error === "invalid_client" || error === "invalid_token" ? "auth" : res.status === 429 ? "rate_limit" : "provider", res.status);
  }
  if (typeof body.access_token !== "string") throw new ZohoError("Zoho returned no access token.", "bad_response", res.status);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresInSec: typeof body.expires_in === "number" ? body.expires_in : 3600,
    scope: typeof body.scope === "string" ? body.scope : "",
    apiDomain: typeof body.api_domain === "string" ? body.api_domain : null,
  };
}

/** Authorization codes live two minutes and work once. */
export const exchangeCode = (config: ZohoConfig, code: string, fetchImpl: Fetch = fetch) =>
  postToken(config, { grant_type: "authorization_code", code, redirect_uri: config.redirectUri }, fetchImpl);

export const refreshAccessToken = (config: ZohoConfig, refreshToken: string, fetchImpl: Fetch = fetch) =>
  postToken(config, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);

/** Revokes a refresh token at Zoho (used by "Disconnect"). Best effort: a failure never blocks removing it locally. */
export async function revokeRefreshToken(config: ZohoConfig, refreshToken: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${config.accountsUrl}/oauth/v2/token/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
