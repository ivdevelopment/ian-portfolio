import "server-only";

import { lookup as dnsLookup } from "node:dns";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest, Agent } from "node:https";
import type { LookupFunction } from "node:net";
import { isPrivateAddress } from "./ip-safety";

export type UpstreamResponse = {
  status: number;
  statusText: string;
  headers: IncomingMessage["headers"];
  body: IncomingMessage;
};

export class UpstreamError extends Error {
  constructor(public readonly kind: "timeout" | "blocked" | "network") {
    super(kind);
  }
}

/**
 * DNS lookup that refuses private/loopback/link-local/metadata addresses AT CONNECTION TIME.
 * Validating only the hostname is not enough (DNS rebinding); this checks the address actually dialled.
 */
export function createSafeLookup(resolve: typeof dnsLookup = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
  resolve(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "", 4);
    }
    const pick = list[0];
    if ((options as { all?: boolean }).all) {
      return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    }
    return callback(null, pick.address, pick.family);
  });
  };
}

export const safeLookup: LookupFunction = createSafeLookup();

const agent = new Agent({ keepAlive: true, maxSockets: 32, lookup: safeLookup });

/**
 * Fetches `url` (an https URL that already passed `validateTargetUrl`). Redirects are NOT followed:
 * the gateway rewrites them so the visitor stays on the preview hostname.
 */
export function fetchUpstream(opts: {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
  headersTimeoutMs?: number;
  idleTimeoutMs?: number;
  /** Test seams only (never set in production): a different resolver and an extra trusted CA. */
  lookup?: LookupFunction;
  ca?: string | Buffer;
  port?: number;
}): Promise<UpstreamResponse> {
  const { url, method, headers, body, headersTimeoutMs = 10_000, idleTimeoutMs = 20_000 } = opts;
  const lookup = opts.lookup ?? safeLookup;

  return new Promise((resolve, reject) => {
    if (url.protocol !== "https:") return reject(new UpstreamError("blocked"));

    const req = httpsRequest(
      {
        agent: opts.ca ? new Agent({ ca: opts.ca, lookup }) : agent,
        lookup,
        ca: opts.ca,
        protocol: "https:",
        hostname: url.hostname,
        port: opts.port ?? 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers: { ...headers, ...(body ? { "content-length": String(body.length) } : {}) },
      },
      (res) => {
        clearTimeout(timer);
        res.setTimeout(idleTimeoutMs, () => res.destroy(new UpstreamError("timeout")));
        resolve({ status: res.statusCode ?? 502, statusText: res.statusMessage ?? "", headers: res.headers, body: res });
      },
    );

    // A dead deployment must not hold the request open: give up if no response headers arrive in time.
    const timer = setTimeout(() => req.destroy(new UpstreamError("timeout")), headersTimeoutMs);
    req.on("error", (error) => {
      clearTimeout(timer);
      const code = (error as NodeJS.ErrnoException).code;
      if (error instanceof UpstreamError) return reject(error);
      reject(new UpstreamError(code === "EBLOCKED" ? "blocked" : "network"));
    });
    if (body) req.write(body);
    req.end();
  });
}
