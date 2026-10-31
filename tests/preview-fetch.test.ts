import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LookupFunction } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GATEWAY_PREFIX, handleGatewayRequest } from "@/lib/preview/gateway";
import { UpstreamError, fetchUpstream } from "@/lib/preview/safe-fetch";
import { signSession } from "@/lib/preview/session";

/** Real TLS requests against a local HTTPS server with a throwaway certificate (needs the openssl CLI). */
let dir = "";
let server: Server;
let port = 0;
let cert = "";
let haveOpenssl = true;
const BIN = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const seen: Array<{ method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];

const toLoopback: LookupFunction = (_h, _o, cb) => (cb as unknown as (e: null, a: unknown) => void)(null, [{ address: "127.0.0.1", family: 4 }]);

beforeAll(async () => {
  try {
    dir = mkdtempSync(join(tmpdir(), "pv-fetch-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=client-site.example-host.com", "-addext", "subjectAltName=DNS:client-site.example-host.com"], { stdio: "ignore" });
  } catch {
    haveOpenssl = false;
    return;
  }
  cert = readFileSync(join(dir, "c.pem"), "utf8");
  server = createServer({ key: readFileSync(join(dir, "k.pem")), cert }, (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "https://client-site.example-host.com/elsewhere" });
        return res.end();
      }
      if (req.url === "/hang") return; // never answers
      if (req.url === "/range.bin") {
        // A minimal RFC 9110 single-range origin: 206, 416, or 200 for anything it does not understand.
        const total = BIN.length;
        const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
        const validator = { etag: '"bin1"', "accept-ranges": "bytes", "content-type": "application/octet-stream" };
        if (!m || (req.headers["if-range"] && req.headers["if-range"] !== '"bin1"')) {
          res.writeHead(200, { ...validator, "content-length": total });
          return res.end(BIN);
        }
        const start = m[1] === "" ? total - Number(m[2]) : Number(m[1]);
        const end = m[1] === "" || m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
        if (start >= total || start > end) {
          res.writeHead(416, { "content-range": `bytes */${total}`, "content-length": 0 });
          return res.end();
        }
        res.writeHead(206, { ...validator, "content-range": `bytes ${start}-${end}/${total}`, "content-length": end - start + 1 });
        return res.end(BIN.subarray(start, end + 1));
      }
      res.writeHead(200, { "content-type": "text/plain", "x-custom": "yes", "set-cookie": ["a=1", "b=2"] });
      res.end(`hello ${req.method} ${body}`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server?.close();
  server?.closeAllConnections?.();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const run = (path: string, extra: Partial<Parameters<typeof fetchUpstream>[0]> = {}) =>
  fetchUpstream({ url: new URL(`https://client-site.example-host.com${path}`), method: "GET", headers: {}, lookup: toLoopback, ca: cert, port, ...extra });

const readAll = async (r: Awaited<ReturnType<typeof fetchUpstream>>) => {
  const chunks: Buffer[] = [];
  for await (const c of r.body) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString();
};

describe("fetchUpstream over real TLS", () => {
  it("fetches, streams the body and exposes status and headers (including repeated Set-Cookie)", async (ctx) => {
    if (!haveOpenssl) return ctx.skip();
    const res = await run("/page?x=1", { headers: { "accept-language": "nl", "accept-encoding": "identity" } });
    expect(res.status).toBe(200);
    expect(res.headers["x-custom"]).toBe("yes");
    expect(res.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
    expect(await readAll(res)).toBe("hello GET ");
    const hit = seen.at(-1)!;
    expect(hit.url).toBe("/page?x=1");
    expect(hit.headers["accept-language"]).toBe("nl");
    expect(hit.headers.host).toMatch(/^client-site.example-host.com/);
  });

  it("forwards request bodies", async (ctx) => {
    if (!haveOpenssl) return ctx.skip();
    const res = await run("/submit", { method: "POST", body: Buffer.from("a=1&b=2"), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(await readAll(res)).toBe("hello POST a=1&b=2");
    expect(seen.at(-1)!.headers["content-length"]).toBe("7");
  });

  it("does NOT follow redirects (the gateway rewrites them)", async (ctx) => {
    if (!haveOpenssl) return ctx.skip();
    const res = await run("/redirect");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://client-site.example-host.com/elsewhere");
    res.body.resume();
  });

  it("gives up on a site that never answers instead of hanging the request", async (ctx) => {
    if (!haveOpenssl) return ctx.skip();
    const started = Date.now();
    await expect(run("/hang", { headersTimeoutMs: 300 })).rejects.toMatchObject({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("reports a refused connection as a plain network failure", async (ctx) => {
    if (!haveOpenssl) return ctx.skip();
    await expect(run("/x", { port: 1 })).rejects.toMatchObject({ kind: "network" });
  });
});

describe("fetchUpstream SSRF guard with the DEFAULT resolver", () => {
  it("refuses a hostname that resolves to a loopback address, before connecting", async () => {
    // `localhost` resolves to 127.0.0.1 / ::1: the connection-time check must refuse it.
    await expect(
      fetchUpstream({ url: new URL("https://localhost/"), method: "GET", headers: {}, headersTimeoutMs: 2000 }),
    ).rejects.toMatchObject({ kind: "blocked" });
  });

  it("refuses non-https URLs outright", async () => {
    await expect(fetchUpstream({ url: new URL("http://example.com/"), method: "GET", headers: {} })).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("Range requests through the gateway against a real HTTPS origin", () => {
  const SECRET = "s".repeat(40);
  const id = "11111111-1111-4111-8111-111111111111";
  const now = new Date("2026-11-01T10:00:00Z");
  const token = () => signSession({ pid: id, sub: "geertkips", ver: 1, iat: 0, exp: Math.floor(now.getTime() / 1000) + 600 }, SECRET);
  const call = async (headers: Record<string, string>) => {
    const deps = {
      config: { baseDomain: "ianverlinden.com", sessionSecret: SECRET, ipSalt: "x".repeat(16), upstreamSecret: () => null, gatewayOnly: false, production: true, allowLocalhost: false },
      now: () => now,
      store: {
        gate: async () => ({ state: "ok" as const, id, sessionVersion: 1, sessionTtlHours: 168, expiresAt: null }),
        verify: async () => ({ result: "denied" as const }),
        upstream: async () => ({ url: "https://client-site.example-host.com", auth: { type: "none" as const } }),
      },
      fetchUpstream: (o: Parameters<typeof fetchUpstream>[0]) => fetchUpstream({ ...o, lookup: toLoopback, ca: cert, port }),
    };
    return handleGatewayRequest(
      new Request(`https://geertkips.ianverlinden.com${GATEWAY_PREFIX}/range.bin`, { headers: { host: "geertkips.ianverlinden.com", cookie: `__Host-pv_session=${token()}`, ...headers } }),
      deps,
    );
  };

  it("returns 206 with the exact bytes and range headers", async (ctx) => {
    if (!haveOpenssl) return ctx.skip();
    const res = await call({ range: "bytes=10-19" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("etag")).toBe('"bin1"');
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BIN.subarray(10, 20));
    expect((await call({ range: "bytes=-5" })).headers.get("content-range")).toBe("bytes 995-999/1000");
    expect((await call({ range: "bytes=990-" })).headers.get("content-range")).toBe("bytes 990-999/1000");
  });

  it("returns the whole file without a Range, and for a stale If-Range", async (ctx) => {
    if (!haveOpenssl) return ctx.skip();
    expect((await call({})).status).toBe(200);
    const stale = await call({ range: "bytes=0-9", "if-range": '"old"' });
    expect(stale.status).toBe(200);
    expect(Buffer.from(await stale.arrayBuffer())).toEqual(BIN);
    expect((await call({ range: "bytes=0-9", "if-range": '"bin1"' })).status).toBe(206);
  });

  it("passes the origin's 416 through, and treats a malformed Range as no Range", async (ctx) => {
    if (!haveOpenssl) return ctx.skip();
    const unsat = await call({ range: "bytes=5000-6000" });
    expect(unsat.status).toBe(416);
    expect(unsat.headers.get("content-range")).toBe("bytes */1000");
    const bad = await call({ range: "bytes=zzz" });
    expect(bad.status).toBe(200);
    expect(Buffer.from(await bad.arrayBuffer())).toEqual(BIN);
  });
});

describe("gateway + real upstream fetch together", () => {
  it("serves a rewritten HTML page and a binary asset from a real HTTPS origin", async (ctx) => {
    if (!haveOpenssl) return ctx.skip();
    const { handleGatewayRequest, GATEWAY_PREFIX } = await import("@/lib/preview/gateway");
    const { signSession } = await import("@/lib/preview/session");
    const { createServer: makeServer } = await import("node:https");

    const png = Buffer.from([137, 80, 78, 71, 0, 255, 1, 2]);
    const origin = makeServer({ key: readFileSync(join(dir, "k.pem")), cert }, (req, res) => {
      if (req.url === "/i.png") {
        res.writeHead(200, { "content-type": "image/png", "content-length": png.length });
        return res.end(png);
      }
      res.writeHead(200, { "content-type": "text/html", "set-cookie": "sid=1; Domain=.client-site.example-host.com; Path=/" });
      res.end('<a href="https://client-site.example-host.com/about">x</a><img src="/i.png">');
    });
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
    const originPort = (origin.address() as AddressInfo).port;

    const SECRET = "s".repeat(40);
    const now = new Date("2026-11-01T10:00:00Z");
    const ver = 1;
    const id = "11111111-1111-4111-8111-111111111111";
    const token = signSession({ pid: id, sub: "geertkips", ver, iat: 0, exp: Math.floor(now.getTime() / 1000) + 600 }, SECRET);
    const deps = {
      config: { baseDomain: "ianverlinden.com", sessionSecret: SECRET, ipSalt: "x".repeat(16), upstreamSecret: () => null, gatewayOnly: false, production: true, allowLocalhost: false },
      now: () => now,
      store: {
        gate: async () => ({ state: "ok" as const, id, sessionVersion: ver, sessionTtlHours: 168, expiresAt: null }),
        verify: async () => ({ result: "denied" as const }),
        upstream: async () => ({ url: "https://client-site.example-host.com", auth: { type: "none" as const } }),
      },
      fetchUpstream: (o: Parameters<typeof fetchUpstream>[0]) => fetchUpstream({ ...o, lookup: toLoopback, ca: cert, port: originPort }),
    };
    const get = (path: string) =>
      handleGatewayRequest(
        new Request(`https://geertkips.ianverlinden.com${GATEWAY_PREFIX}${path}`, { headers: { host: "geertkips.ianverlinden.com", cookie: `__Host-pv_session=${token}` } }),
        deps,
      );

    const page = await get("/");
    expect(page.status).toBe(200);
    expect(await page.text()).toBe('<a href="https://geertkips.ianverlinden.com/about">x</a><img src="/i.png">');
    expect(page.headers.getSetCookie()).toEqual(["sid=1; Path=/"]);
    expect(page.headers.get("cache-control")).toBe("private, no-store, max-age=0");

    const image = await get("/i.png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
    expect(image.headers.get("content-type")).toBe("image/png");

    origin.close();
    origin.closeAllConnections?.();
  });
});
