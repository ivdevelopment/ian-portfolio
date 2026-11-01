import type { ZohoConfig } from "./config";
import { refreshAccessToken, ZohoError, type Fetch } from "./oauth";
import type { ZohoMessage } from "./normalize";

/** Official, documented endpoints only (https://www.zoho.com/mail/help/api/): account lookup and message search. */
export type ZohoAccount = { accountId: string; primaryEmail: string };

type Envelope<T> = { status?: { code?: number; description?: string }; data?: T };

/**
 * Minimal Mail API client. The access token comes from `getAccessToken` (cached by the caller); a 401 triggers exactly
 * one forced refresh and retry. Rate limiting and provider failures surface as typed errors, never as partial data.
 */
export class ZohoMailClient {
  constructor(
    private readonly config: Pick<ZohoConfig, "mailUrl">,
    private readonly getAccessToken: (force?: boolean) => Promise<string>,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async request<T>(path: string, params: Record<string, string | number> = {}, retried = false): Promise<T> {
    const url = new URL(`${this.config.mailUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { Authorization: `Zoho-oauthtoken ${await this.getAccessToken(retried)}`, Accept: "application/json" }, cache: "no-store" });
    } catch (error) {
      if (error instanceof ZohoError) throw error;
      throw new ZohoError("Could not reach Zoho Mail.", "network");
    }
    if (res.status === 401 && !retried) return this.request<T>(path, params, true);
    if (res.status === 401 || res.status === 403) {
      // Zoho signals throttling with 403/429-style answers as well as auth problems: read the body before deciding.
      const text = await res.text().catch(() => "");
      if (/too many|rate|limit|throttl/i.test(text)) throw new ZohoError("Zoho is rate limiting requests.", "rate_limit", res.status, retryAfter(res));
      throw new ZohoError("Zoho rejected the credentials. Reconnect the mailbox.", "auth", res.status);
    }
    if (res.status === 429) throw new ZohoError("Zoho is rate limiting requests.", "rate_limit", 429, retryAfter(res));
    if (res.status >= 500) throw new ZohoError(`Zoho Mail is unavailable (${res.status}).`, "provider", res.status);
    if (!res.ok) throw new ZohoError(`Zoho Mail returned ${res.status}.`, "provider", res.status);
    const body = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!body || body.data === undefined) throw new ZohoError("Zoho Mail returned an unexpected response.", "bad_response", res.status);
    return body.data;
  }

  async getAccounts(): Promise<ZohoAccount[]> {
    const data = await this.request<Array<{ accountId?: string | number; primaryEmailAddress?: string; mailboxAddress?: string }>>("/api/accounts");
    return data
      .filter((a) => a.accountId !== undefined)
      .map((a) => ({ accountId: String(a.accountId), primaryEmail: (a.primaryEmailAddress ?? a.mailboxAddress ?? "").toLowerCase() }));
  }

  searchMessages(accountId: string, searchKey: string, start: number, limit: number): Promise<ZohoMessage[]> {
    return this.request<ZohoMessage[]>(`/api/accounts/${encodeURIComponent(accountId)}/messages/search`, { searchKey, start, limit });
  }

  /** Pages of at most 200 (the documented maximum), stopping at a short page or `maxMessages`. */
  async *searchAll(accountId: string, searchKey: string, opts: { pageSize?: number; maxMessages?: number } = {}): AsyncGenerator<ZohoMessage[]> {
    const pageSize = Math.min(200, opts.pageSize ?? 200);
    const max = opts.maxMessages ?? 5000;
    let start = 1;
    let seen = 0;
    while (seen < max) {
      const page = await this.searchMessages(accountId, searchKey, start, Math.min(pageSize, max - seen));
      if (page.length === 0) return;
      yield page;
      seen += page.length;
      if (page.length < pageSize) return;
      start += page.length;
    }
  }
}

function retryAfter(res: Response): number | undefined {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/**
 * Access-token source for one stored connection: refreshes with the (decrypted) refresh token, caches the access token
 * until shortly before it expires, and never exposes either token beyond the process.
 */
export function createTokenSource(config: ZohoConfig, refreshToken: string, fetchImpl: Fetch = fetch, now: () => number = Date.now) {
  let cached: { token: string; expiresAt: number } | null = null;
  return async (force = false): Promise<string> => {
    if (!force && cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const fresh = await refreshAccessToken(config, refreshToken, fetchImpl);
    cached = { token: fresh.accessToken, expiresAt: now() + fresh.expiresInSec * 1000 };
    return fresh.accessToken;
  };
}
