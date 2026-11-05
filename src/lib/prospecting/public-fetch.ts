import "server-only";

import { request as httpRequest, Agent as HttpAgent, type IncomingMessage } from "node:http";
import { request as httpsRequest, Agent as HttpsAgent } from "node:https";
import { safeLookup } from "@/lib/preview/safe-fetch";
import { validateTargetUrl } from "@/lib/preview/target-url";

/**
 * Fetching pages of businesses the Prospect Finder knows nothing about. Everything researched is untrusted input, so every request goes
 * through these layers, each of which is enough to stop the request on its own:
 *
 *   1. the URL is validated (http/https only, no credentials, standard ports, a public DNS name: no IP literals, no localhost/internal suffixes)
 *   2. the address that is actually dialled must be public (DNS rebinding safe, see preview/safe-fetch createSafeLookup)
 *   3. redirects are followed by hand, a limited number of times, and every hop goes through 1 and 2 again (no redirect into a private network)
 *   4. the response is capped (size, time) and must be HTML (or plain text for robots.txt); nothing is executed, rendered or stored
 */

export const FETCH_LIMITS = { maxRedirects: 4, maxBytes: 600_000, timeoutMs: 8_000 } as const;
export const USER_AGENT = "ProspectFinder/1.0 (+https://ianverlinden.com)";

export type PublicUrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** First layer. Reuses the preview feature's hostname rules, so there is one definition of "a public website name". */
export function validatePublicUrl(raw: string): PublicUrlCheck {
  const input = raw.trim();
  if (!input || input.length > 2000 || /[\s\u0000-\u001f\\]/.test(input)) return { ok: false, error: "invalid url" };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "invalid url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "unsupported protocol" };
  if (url.username || url.password) return { ok: false, error: "credentials in url" };
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== defaultPort) return { ok: false, error: "non-standard port" };
  const host = validateTargetUrl(`https://${url.hostname}`);
  if (!host.ok) return { ok: false, error: "not a public website name" };
  url.hash = "";
  return { ok: true, url };
}

export type FetchResult =
  | { ok: true; finalUrl: string; status: number; body: string; truncated: boolean }
  | { ok: false; reason: "invalid_url" | "blocked" | "timeout" | "network" | "too_many_redirects" | "not_html" | "status"; status?: number; detail?: string };

export type RawResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Buffer | Uint8Array | string> };
/** One HTTP round trip, no redirects. The only thing tests replace; the default dials through the safe lookup. */
export type RequestOnce = (url: URL, headers: Record<string, string>, timeoutMs: number) => Promise<RawResponse>;

const httpsAgent = new HttpsAgent({ keepAlive: false, lookup: safeLookup, maxSockets: 8 });
const httpAgent = new HttpAgent({ keepAlive: false, lookup: safeLookup, maxSockets: 8 });

export const requestOnce: RequestOnce = (url, headers, timeoutMs) =>
  new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const req = (isHttps ? httpsRequest : httpRequest)(
      { agent: isHttps ? httpsAgent : httpAgent, lookup: safeLookup, protocol: url.protocol, hostname: url.hostname, port: url.port || (isHttps ? 443 : 80), path: `${url.pathname}${url.search}`, method: "GET", headers },
      (res: IncomingMessage) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }),
    );
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), timeoutMs);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });

const header = (h: RawResponse["headers"], name: string) => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

async function readCapped(body: RawResponse["body"], max: number): Promise<{ text: string; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of body) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    if (size + buf.length > max) {
      chunks.push(buf.subarray(0, max - size));
      truncated = true;
      (body as { destroy?: () => void }).destroy?.();
      break;
    }
    chunks.push(buf);
    size += buf.length;
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

/** GET a public page. Never throws: the caller gets a reason and carries on with the next business. */
export async function fetchPublicPage(raw: string, opts: { kind?: "html" | "text"; request?: RequestOnce; limits?: { maxRedirects?: number; maxBytes?: number; timeoutMs?: number } } = {}): Promise<FetchResult> {
  const limits = { ...FETCH_LIMITS, ...opts.limits };
  const request = opts.request ?? requestOnce;
  const accept = opts.kind === "text" ? "text/plain,*/*;q=0.1" : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1";
  let current = validatePublicUrl(raw);
  if (!current.ok) return { ok: false, reason: "invalid_url", detail: current.error };
  let url = current.url;

  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    let res: RawResponse;
    try {
      res = await request(url, { "user-agent": USER_AGENT, accept, "accept-language": "nl-BE,nl;q=0.9,en;q=0.5" }, limits.timeoutMs);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EBLOCKED") return { ok: false, reason: "blocked" };
      if (code === "ETIMEDOUT" || (error as Error).message === "timeout") return { ok: false, reason: "timeout" };
      return { ok: false, reason: "network" };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = header(res.headers, "location");
      (res.body as { destroy?: () => void }).destroy?.();
      if (!location) return { ok: false, reason: "status", status: res.status };
      if (hop === limits.maxRedirects) return { ok: false, reason: "too_many_redirects" };
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return { ok: false, reason: "invalid_url" };
      }
      current = validatePublicUrl(next.toString());
      // A redirect into a private or internal destination is refused before anything is dialled.
      if (!current.ok) return { ok: false, reason: "blocked", detail: current.error };
      url = current.url;
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      (res.body as { destroy?: () => void }).destroy?.();
      return { ok: false, reason: "status", status: res.status };
    }
    const type = (header(res.headers, "content-type") ?? "").toLowerCase();
    const acceptable = opts.kind === "text" ? type === "" || type.startsWith("text/") : type === "" || type.includes("html") || type.includes("xml");
    if (!acceptable) {
      (res.body as { destroy?: () => void }).destroy?.();
      return { ok: false, reason: "not_html" };
    }
    try {
      const { text, truncated } = await readCapped(res.body, limits.maxBytes);
      return { ok: true, finalUrl: url.toString(), status: res.status, body: text, truncated };
    } catch (error) {
      return { ok: false, reason: (error as NodeJS.ErrnoException).code === "EBLOCKED" ? "blocked" : "network" };
    }
  }
  return { ok: false, reason: "too_many_redirects" };
}
