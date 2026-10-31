import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PreviewConfig } from "@/lib/preview/config";
import { GATEWAY_PREFIX, handleGatewayRequest, originalPath, type GatewayDeps } from "@/lib/preview/gateway";
import type { UpstreamResponse } from "@/lib/preview/safe-fetch";
import { UpstreamError, createSafeLookup } from "@/lib/preview/safe-fetch";
import { signSession, sessionExpiry } from "@/lib/preview/session";
import type { GateInfo, PreviewStore, VerifyOutcome } from "@/lib/preview/store";
import { withStateCache } from "@/lib/preview/store";

const SECRET = "s".repeat(40);
const CODE = "GK-7F3K-9MQX-P4TD";
const TARGET = "https://client-site.example-host.com";
const HOST = "geertkips.ianverlinden.com";

const config: PreviewConfig = {
  baseDomain: "ianverlinden.com",
  sessionSecret: SECRET,
  ipSalt: "x".repeat(16),
  stateCacheSeconds: 0,
  gatewayOnly: false,
  production: true,
  allowLocalhost: false,
};

/** An in-memory stand-in with the same semantics as the SQL functions. */
class FakeDb implements PreviewStore {
  previews = new Map<string, { id: string; code: string; active: boolean; expiresAt: Date | null; version: number; ttl: number; target: string }>();
  failures: Array<{ sub: string; ip: string }> = [];
  logins = 0;
  verifyCalls = 0;
  gateCalls = 0;
  constructor(public now = () => new Date("2026-11-01T10:00:00Z")) {
    this.add("geertkips", "11111111-1111-4111-8111-111111111111");
    this.add("other", "22222222-2222-4222-8222-222222222222");
  }
  add(sub: string, id: string) {
    this.previews.set(sub, { id, code: CODE, active: true, expiresAt: null, version: 1, ttl: 168, target: TARGET });
  }
  p(sub = "geertkips") {
    return this.previews.get(sub)!;
  }
  private state(p: ReturnType<FakeDb["p"]>) {
    if (!p.active) return "inactive" as const;
    if (p.expiresAt && p.expiresAt <= this.now()) return "expired" as const;
    return "ok" as const;
  }
  async gate(sub: string): Promise<GateInfo> {
    this.gateCalls++;
    const p = this.previews.get(sub);
    if (!p) return { state: "missing" };
    const s = this.state(p);
    return s === "ok" ? { state: "ok", id: p.id, sessionVersion: p.version, sessionTtlHours: p.ttl, expiresAt: p.expiresAt?.toISOString() ?? null } : { state: s };
  }
  async verify(sub: string, code: string, ip: string): Promise<VerifyOutcome> {
    this.verifyCalls++;
    const p = this.previews.get(sub);
    if (!p) return { result: "missing" };
    if (this.state(p) !== "ok") return { result: "unavailable" };
    const mine = this.failures.filter((f) => f.sub === sub && f.ip === ip).length;
    if (mine >= 5 || this.failures.filter((f) => f.sub === sub).length >= 40) return { result: "limited" };
    if (code === p.code) {
      this.failures = this.failures.filter((f) => !(f.sub === sub && f.ip === ip));
      this.logins++;
      return { result: "ok", id: p.id, sessionVersion: p.version, sessionTtlHours: p.ttl, expiresAt: p.expiresAt?.toISOString() ?? null };
    }
    this.failures.push({ sub, ip });
    return { result: "denied" };
  }
  async target(id: string, version: number) {
    const p = [...this.previews.values()].find((x) => x.id === id);
    return p && this.state(p) === "ok" && p.version === version ? p.target : null;
  }
  reset(newCode: string, sub = "geertkips") {
    this.p(sub).code = newCode;
    this.p(sub).version++;
  }
  setActive(active: boolean, sub = "geertkips") {
    this.p(sub).active = active;
    if (!active) this.p(sub).version++;
  }
}

type UpstreamSpec = {
  status?: number;
  headers?: Record<string, string | string[]>;
  body?: string | Buffer;
  error?: UpstreamError;
};

function setup(upstream: UpstreamSpec = {}, overrides: Partial<GatewayDeps> = {}) {
  const db = new FakeDb();
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: Buffer }> = [];
  const logs: Record<string, unknown>[] = [];
  const deps: GatewayDeps = {
    config,
    store: db,
    now: db.now,
    log: (e) => logs.push(e),
    fetchUpstream: async (opts) => {
      calls.push({ url: opts.url.toString(), method: opts.method, headers: opts.headers, body: opts.body });
      if (upstream.error) throw upstream.error;
      const body = Buffer.from(upstream.body ?? "<html><a href=\"https://client-site.example-host.com/about\">x</a></html>");
      return {
        status: upstream.status ?? 200,
        statusText: "OK",
        headers: { "content-type": "text/html; charset=utf-8", ...(upstream.headers ?? {}) },
        body: Readable.from([body]),
      } as unknown as UpstreamResponse;
    },
    ...overrides,
  };
  return { db, deps, calls, logs };
}

const req = (path = "/", init: { host?: string; method?: string; headers?: Record<string, string>; body?: string } = {}) => {
  const host = init.host ?? HOST;
  // The URL's own host is irrelevant: the gateway reads the (spoofable) Host header, so that is what varies.
  return new Request(`https://${HOST}${GATEWAY_PREFIX}${path === "/" ? "" : path}`, {
    method: init.method ?? "GET",
    headers: { host, ...(init.headers ?? {}) },
    body: init.body,
  });
};

const cookieFor = (db: FakeDb, sub = "geertkips", overrides: Partial<{ ver: number; exp: number; pid: string; sub: string }> = {}) => {
  const p = db.p(sub);
  const iat = Math.floor(db.now().getTime() / 1000);
  const token = signSession(
    { pid: overrides.pid ?? p.id, sub: overrides.sub ?? sub, ver: overrides.ver ?? p.version, iat, exp: overrides.exp ?? sessionExpiry(db.now(), p.ttl, null) },
    SECRET,
  );
  return `__Host-pv_session=${token}`;
};

async function login(deps: GatewayDeps, code = CODE, extra: Record<string, string> = {}, ip = "9.9.9.9") {
  return handleGatewayRequest(
    req("/__preview/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: `https://${HOST}`, "x-forwarded-for": ip, ...extra },
      body: new URLSearchParams({ code, next: "/about" }).toString(),
    }),
    deps,
  );
}

describe("path handling", () => {
  it("recovers the visitor's path from the internal rewrite", () => {
    expect(originalPath(new URL(`https://x/${GATEWAY_PREFIX.slice(1)}`))).toBe("/");
    expect(originalPath(new URL(`https://x${GATEWAY_PREFIX}/a/b?c=1`))).toBe("/a/b");
  });
});

describe("hostname routing", () => {
  it("serves only exact preview hosts and treats everything else as not ours", async () => {
    const { deps, db } = setup();
    for (const host of ["ianverlinden.com", "www.ianverlinden.com", "admin.ianverlinden.com", "evil.com", "geertkips.ianverlinden.com.evil.com", "a.b.ianverlinden.com", "127.0.0.1", "geertkips.ianverlinden.com@evil.com"]) {
      const res = await handleGatewayRequest(req("/", { host }), deps);
      expect(res.status, host).toBe(404);
    }
    expect(db.gateCalls).toBe(0);
  });

  it("returns a clean 404 for an unknown preview and never reveals more", async () => {
    const { deps } = setup();
    const res = await handleGatewayRequest(req("/", { host: "nobody.ianverlinden.com" }), deps);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/client-site|target/i);
  });

  it("fails closed when the gateway is not configured", async () => {
    for (const patch of [{ sessionSecret: null }, { ipSalt: null }]) {
      const { deps, calls } = setup({}, { config: { ...config, ...patch } });
      const res = await handleGatewayRequest(req("/", { headers: { cookie: "x=1" } }), deps);
      expect(res.status).toBe(503);
      expect(calls).toHaveLength(0);
    }
  });
});

describe("access flow", () => {
  it("1. without a session shows the branded access screen (no target, no navigation)", async () => {
    const { deps, calls } = setup();
    const res = await handleGatewayRequest(req("/projects"), deps);
    const html = await res.text();
    expect(res.status).toBe(401);
    expect(html).toContain("Private project preview");
    expect(html).toContain("Deze preview is alleen beschikbaar voor genodigden.");
    expect(html).toContain("Toegangscode");
    expect(html).toContain('name="next" value="/projects"');
    expect(html).not.toContain(TARGET);
    expect(html).not.toMatch(/<a |<script/i);
    expect(calls).toHaveLength(0);
  });

  it("2. a wrong code is denied generically and sets no cookie", async () => {
    const { deps } = setup();
    const res = await login(deps, "WRONG-CODE-1234");
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    const html = await res.text();
    expect(html).toContain("Ongeldige toegangscode.");
    expect(html).not.toMatch(/close|almost|attempt|remaining|expired|exists/i);
  });

  it("3. the correct code sets a hardened, preview-bound cookie and returns to the page", async () => {
    const { deps, logs } = setup();
    const res = await login(deps);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/about");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^__Host-pv_session=v1\./);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).toMatch(/Max-Age=604800/); // 7 days
    expect(cookie).not.toContain(CODE);
    // Safe logging only.
    expect(JSON.stringify(logs)).not.toContain(CODE);
    expect(JSON.stringify(logs)).not.toContain("9.9.9.9");
    expect(JSON.stringify(logs)).not.toContain("v1.");
  });

  it("4. a valid session reaches the client's site, and keeps working on refresh", async () => {
    const { deps, db, calls } = setup();
    const cookie = cookieFor(db);
    for (let i = 0; i < 2; i++) {
      const res = await handleGatewayRequest(req("/about?x=1", { headers: { cookie } }), deps);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("https://geertkips.ianverlinden.com/about");
    }
    expect(calls[0].url).toBe(`${TARGET}/about?x=1`);
  });

  it("5. a code reset signs everyone out and the old code stops working", async () => {
    const { deps, db, calls } = setup();
    const cookie = cookieFor(db);
    expect((await handleGatewayRequest(req("/", { headers: { cookie } }), deps)).status).toBe(200);

    db.reset("GK-NEW1-CODE-2026");
    const res = await handleGatewayRequest(req("/", { headers: { cookie } }), deps);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/); // stale cookie cleared
    expect(calls).toHaveLength(1);
    expect((await login(deps, CODE, {}, "1.1.1.1")).status).toBe(401);
    expect((await login(deps, "GK-NEW1-CODE-2026", {}, "1.1.1.2")).status).toBe(303);
  });

  it("6. disabling cuts access at once; re-enabling needs a fresh login", async () => {
    const { deps, db, calls } = setup();
    const cookie = cookieFor(db);
    db.setActive(false);
    const res = await handleGatewayRequest(req("/", { headers: { cookie } }), deps);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Deze preview is momenteel niet beschikbaar.");
    expect(calls).toHaveLength(0);

    db.setActive(true);
    expect((await handleGatewayRequest(req("/", { headers: { cookie } }), deps)).status).toBe(401);
    expect((await login(deps)).status).toBe(303);
  });

  it("7. an expired preview is unavailable for everyone, sessions included", async () => {
    const { deps, db, calls } = setup();
    const cookie = cookieFor(db);
    db.p().expiresAt = new Date("2026-11-01T09:00:00Z");
    for (const r of [await handleGatewayRequest(req("/", { headers: { cookie } }), deps), await login(deps)]) {
      expect(r.status).toBe(503);
    }
    expect(calls).toHaveLength(0);
    // Extending it makes it work again.
    db.p().expiresAt = null;
    expect((await login(deps, CODE, {}, "5.5.5.5")).status).toBe(303);
  });

  it("answers robots.txt for crawlers: disallow everything", async () => {
    const { deps } = setup();
    const res = await handleGatewayRequest(req("/robots.txt"), deps);
    expect(await res.text()).toBe("User-agent: *\nDisallow: /\n");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("logs out by clearing the cookie", async () => {
    const { deps } = setup();
    const res = await handleGatewayRequest(req("/__preview/logout", { method: "POST" }), deps);
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});

describe("security", () => {
  it("rejects tampered, expired, foreign and mismatched sessions", async () => {
    const { deps, db, calls } = setup();
    const good = cookieFor(db);
    const forged = good.replace(/\.[^.]+$/, ".AAAA");
    const stale = cookieFor(db, "geertkips", { exp: Math.floor(db.now().getTime() / 1000) - 10 });
    const otherPreview = cookieFor(db, "other"); // a valid session for ANOTHER preview
    const wrongPid = cookieFor(db, "geertkips", { pid: "22222222-2222-4222-8222-222222222222" });
    const wrongSub = cookieFor(db, "geertkips", { sub: "other" });
    const oldVersion = cookieFor(db, "geertkips", { ver: 0 });
    for (const [name, cookie] of Object.entries({ forged, stale, otherPreview, wrongPid, wrongSub, oldVersion, garbage: "__Host-pv_session=nonsense", none: "" })) {
      const res = await handleGatewayRequest(req("/", { headers: cookie ? { cookie } : {} }), deps);
      expect(res.status, name).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it("rate limits brute force per visitor without revealing counts or locking permanently", async () => {
    const { deps, db } = setup();
    for (let i = 0; i < 5; i++) expect((await login(deps, `wrong-${i}`, {}, "7.7.7.7")).status).toBe(401);
    const blocked = await login(deps, CODE, {}, "7.7.7.7"); // even the right code
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("900");
    expect(await blocked.text()).not.toMatch(/\b\d+\b.*(attempt|poging)|remaining|resterend/i);
    // Another visitor is unaffected; the preview itself is never locked.
    expect((await login(deps, CODE, {}, "8.8.8.8")).status).toBe(303);
    db.failures = [];
    expect((await login(deps, CODE, {}, "7.7.7.7")).status).toBe(303);
  });

  it("hashes the visitor's IP with a secret salt before it leaves the gateway", async () => {
    const seen: string[] = [];
    const { deps, db } = setup();
    const original = db.verify.bind(db);
    db.verify = async (s, c, ip) => (seen.push(ip), original(s, c, ip));
    await login(deps, CODE, {}, "203.0.113.77");
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(seen[0]).not.toContain("203.0.113.77");
  });

  it("blocks cross-site login attempts (CSRF)", async () => {
    const { deps, db } = setup();
    for (const headers of [{ origin: "https://evil.com" }, { origin: "https://geertkips.ianverlinden.com.evil.com" }, {}]) {
      const res = await handleGatewayRequest(
        req("/__preview/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(headers as Record<string, string>) }, body: `code=${CODE}` }),
        deps,
      );
      expect(res.status).toBe(403);
    }
    expect(db.verifyCalls).toBe(0);
  });

  it("accepts a same-origin form post whose Origin is 'null' (referrer policy) only with a same-origin signal", async () => {
    const { deps } = setup();
    const post = (headers: Record<string, string>) =>
      handleGatewayRequest(
        req("/__preview/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "null", ...headers } as Record<string, string>, body: `code=${CODE}` }),
        deps,
      );
    expect((await post({ "sec-fetch-site": "same-origin" })).status).toBe(303);
    expect((await post({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({})).status).toBe(403);
  });

  it("escapes and constrains the post-login destination (no XSS, no open redirect)", async () => {
    const { deps } = setup();
    const xss = await handleGatewayRequest(req('/x"><script>alert(1)</script>'), deps);
    const html = await xss.text();
    expect(html).not.toContain("<script>alert");
    for (const next of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "/__preview/login"]) {
      const res = await handleGatewayRequest(
        req("/__preview/login", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", origin: `https://${HOST}` },
          body: new URLSearchParams({ code: CODE, next }).toString(),
        }),
        deps,
      );
      expect(res.headers.get("location"), next).toBe("/");
    }
  });

  it("uses a CSP only on its own pages, never on the client's site", async () => {
    const { deps, db } = setup({ headers: { "content-security-policy": "default-src 'self' https://client-site.example-host.com" } });
    const pageRes = await handleGatewayRequest(req("/"), deps);
    expect(pageRes.headers.get("content-security-policy")).toContain("default-src 'none'");
    const proxied = await handleGatewayRequest(req("/", { headers: { cookie: cookieFor(db) } }), deps);
    expect(proxied.headers.get("content-security-policy")).toBe("default-src 'self' https://geertkips.ianverlinden.com");
  });
});

describe("caching and indexing (protected content must never be shared or indexed)", () => {
  it("forces private, no-store and noindex on every response, overriding the upstream", async () => {
    const { deps, db } = setup({ headers: { "cache-control": "public, s-maxage=31536000", etag: '"x"', "x-robots-tag": "all", vary: "Accept" } });
    const responses = [
      await handleGatewayRequest(req("/"), deps), // access page
      await handleGatewayRequest(req("/", { headers: { cookie: cookieFor(db) } }), deps), // proxied
      await handleGatewayRequest(req("/", { host: "nobody.ianverlinden.com" }), deps), // 404
      await login(deps, "bad"), // denied
      await login(deps), // success redirect
    ];
    for (const res of responses) {
      expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(res.headers.get("cdn-cache-control")).toBe("no-store");
      expect(res.headers.get("vercel-cdn-cache-control")).toBe("no-store");
      expect(res.headers.get("vary")).toMatch(/Cookie/);
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
      expect(res.headers.get("etag")).toBeNull();
      expect(res.headers.get("x-preview-gateway")).toBe("1");
    }
  });
});

describe("reverse proxy", () => {
  it("forwards only allow-listed headers and never the portfolio's cookies", async () => {
    const { deps, db, calls } = setup();
    await handleGatewayRequest(
      req("/page", {
        headers: {
          cookie: `${cookieFor(db)}; sb-abc-auth-token=ADMINSECRET; site-locale=en; client_pref=dark; __Host-pv_session=zzz`,
          authorization: "Bearer client-token",
          "x-forwarded-for": "1.2.3.4",
          "x-vercel-id": "x",
          origin: `https://${HOST}`,
          referer: `https://${HOST}/page`,
          "accept-language": "nl-BE",
          "x-evil": "1",
        },
      }),
      deps,
    );
    const h = calls[0].headers;
    expect(h.cookie).toBe("client_pref=dark");
    expect(JSON.stringify(h)).not.toMatch(/ADMINSECRET|site-locale|pv_session/);
    expect(h.authorization).toBe("Bearer client-token");
    expect(h.origin).toBe(TARGET);
    expect(h.referer).toBe(`${TARGET}/page`);
    expect(h["accept-encoding"]).toBe("identity");
    expect(h["accept-language"]).toBe("nl-BE");
    expect(h["x-evil"]).toBeUndefined();
    expect(h["x-forwarded-for"]).toBeUndefined();
    expect(h["x-vercel-id"]).toBeUndefined();
  });

  it("keeps redirects on the preview hostname and never exposes the underlying address", async () => {
    const { deps, db } = setup({ status: 301, headers: { location: `${TARGET}/nieuw?x=1` } });
    const res = await handleGatewayRequest(req("/oud", { headers: { cookie: cookieFor(db) } }), deps);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://geertkips.ianverlinden.com/nieuw?x=1");

    const rel = setup({ status: 302, headers: { location: "/login" } });
    const r2 = await handleGatewayRequest(req("/", { headers: { cookie: cookieFor(rel.db) } }), rel.deps);
    expect(r2.headers.get("location")).toBe("https://geertkips.ianverlinden.com/login");

    const external = setup({ status: 302, headers: { location: "https://cdn.other.com/x" } });
    const r3 = await handleGatewayRequest(req("/", { headers: { cookie: cookieFor(external.db) } }), external.deps);
    expect(r3.headers.get("location")).toBe("https://cdn.other.com/x");
  });

  it("rewrites the client's own absolute addresses in HTML, CSS, JS and JSON, but not third-party hosts", async () => {
    const body = `<a href="${TARGET}/a">a</a><script>var u="https:\\/\\/client-site.example-host.com\\/api";var c="//client-site.example-host.com/x"</script><img src="https://cdn.third.com/i.png">`;
    const { deps, db } = setup({ body });
    const text = await (await handleGatewayRequest(req("/", { headers: { cookie: cookieFor(db) } }), deps)).text();
    expect(text).not.toContain("client-site.example-host.com");
    expect(text).toContain("https://geertkips.ianverlinden.com/a");
    expect(text).toContain("https:\\/\\/geertkips.ianverlinden.com\\/api");
    expect(text).toContain("//geertkips.ianverlinden.com/x");
    expect(text).toContain("https://cdn.third.com/i.png");

    const css = setup({ headers: { "content-type": "text/css" }, body: `a{background:url(${TARGET}/bg.png)}` });
    expect(await (await handleGatewayRequest(req("/s.css", { headers: { cookie: cookieFor(css.db) } }), css.deps)).text()).toBe("a{background:url(https://geertkips.ianverlinden.com/bg.png)}");
  });

  it("streams binary content untouched and does not rewrite compressed bodies", async () => {
    const bytes = Buffer.from([0, 1, 2, 3, 255, 254]);
    const img = setup({ headers: { "content-type": "image/png", "content-length": "6" }, body: bytes });
    const res = await handleGatewayRequest(req("/i.png", { headers: { cookie: cookieFor(img.db) } }), img.deps);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get("content-type")).toBe("image/png");

    const gz = setup({ headers: { "content-type": "text/html", "content-encoding": "gzip" }, body: Buffer.from("raw-bytes-with-" + TARGET) });
    const out = Buffer.from(await (await handleGatewayRequest(req("/", { headers: { cookie: cookieFor(gz.db) } }), gz.deps)).arrayBuffer());
    expect(out.toString()).toContain(TARGET); // left intact: can't safely rewrite
  });

  it("keeps the client's cookies host-only and drops anything that could collide with the gateway", async () => {
    const { deps, db } = setup({ headers: { "set-cookie": ["theme=dark; Domain=.client-site.example-host.com; Path=/; Secure", "__Host-pv_session=evil; Path=/", "sb-x-auth-token=evil; Path=/"] } });
    const res = await handleGatewayRequest(req("/", { headers: { cookie: cookieFor(db) } }), deps);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toEqual(["theme=dark; Path=/; Secure"]);
  });

  it("strips hop-by-hop and platform headers from the response", async () => {
    const { deps, db } = setup({ headers: { connection: "keep-alive", "transfer-encoding": "chunked", server: "Vercel", "x-powered-by": "Next.js", "strict-transport-security": "max-age=1", via: "1.1 x", "x-vercel-cache": "HIT", "cf-ray": "abc", "x-custom": "keep" } });
    const res = await handleGatewayRequest(req("/", { headers: { cookie: cookieFor(db) } }), deps);
    for (const h of ["connection", "transfer-encoding", "server", "x-powered-by", "strict-transport-security", "via", "x-vercel-cache", "cf-ray"]) {
      expect(res.headers.get(h), h).toBeNull();
    }
    expect(res.headers.get("x-custom")).toBe("keep");
  });

  it("cannot be steered off the target host by the requested path", async () => {
    const { deps, db, calls } = setup();
    await handleGatewayRequest(req("//evil.com/x", { headers: { cookie: cookieFor(db) } }), deps);
    await handleGatewayRequest(req("/..%2f..%2fetc", { headers: { cookie: cookieFor(db) } }), deps);
    for (const c of calls) expect(new URL(c.url).origin).toBe(TARGET);
  });

  it("forwards bodies for form posts but refuses oversized ones", async () => {
    const { deps, db, calls } = setup();
    const ok = await handleGatewayRequest(req("/contact", { method: "POST", headers: { cookie: cookieFor(db), "content-type": "application/json" }, body: '{"a":1}' }), deps);
    expect(ok.status).toBe(200);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body?.toString()).toBe('{"a":1}');
    const big = await handleGatewayRequest(req("/contact", { method: "POST", headers: { cookie: cookieFor(db), "content-length": String(10 * 1024 * 1024) }, body: "x" }), deps);
    expect(big.status).toBe(413);
  });

  it("refuses a stored target that fails validation, even if the database holds one", async () => {
    for (const bad of ["http://169.254.169.254", "https://127.0.0.1", "https://ianverlinden.com", "https://x.internal"]) {
      const { deps, db, calls } = setup();
      db.p().target = bad;
      const res = await handleGatewayRequest(req("/", { headers: { cookie: cookieFor(db) } }), deps);
      expect(res.status, bad).toBe(502);
      expect(calls).toHaveLength(0);
    }
  });
});

describe("upstream failures never leak details", () => {
  it("shows a clean page for timeouts, network errors and blocked addresses", async () => {
    for (const [kind, status] of [["timeout", 504], ["network", 502], ["blocked", 502]] as const) {
      const { deps, db, logs } = setup({ error: new UpstreamError(kind) });
      const res = await handleGatewayRequest(req("/", { headers: { cookie: cookieFor(db) } }), deps);
      expect(res.status, kind).toBe(status);
      const html = await res.text();
      expect(html).toContain("Preview tijdelijk niet beschikbaar");
      expect(html).not.toMatch(/ECONN|ENOTFOUND|stack|client-site|example-host/i);
      expect(JSON.stringify(logs)).toContain(kind);
    }
  });

  it("a database outage yields the same clean page, not a crash", async () => {
    const { deps } = setup({}, { store: { gate: async () => { throw new Error("db down"); }, verify: async () => { throw new Error("x"); }, target: async () => null } });
    const res = await handleGatewayRequest(req("/"), deps);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/db down/);
  });
});

describe("state cache", () => {
  it("serves repeated lookups from memory for the configured window, then refreshes", async () => {
    let t = 1_000;
    const db = new FakeDb();
    const cached = withStateCache(db, 5, () => t);
    await cached.gate("geertkips");
    await cached.gate("geertkips");
    expect(db.gateCalls).toBe(1);
    t += 6_000;
    await cached.gate("geertkips");
    expect(db.gateCalls).toBe(2);
    // A login always clears the entry and is never answered from cache.
    await cached.verify("geertkips", "wrong", "ip");
    await cached.gate("geertkips");
    expect(db.gateCalls).toBe(3);
    expect(withStateCache(db, 0)).toBe(db);
  });
});

describe("DNS-rebinding guard (address checked at connection time)", () => {
  const lookupFor = (addresses: Array<{ address: string; family: number }>) =>
    createSafeLookup(((_h: string, _o: unknown, cb: (e: null, a: unknown) => void) => cb(null, addresses)) as never);
  const run = (lookup: ReturnType<typeof createSafeLookup>) =>
    new Promise<{ error: NodeJS.ErrnoException | null; address?: unknown }>((resolve) =>
      (lookup as unknown as (h: string, o: object, cb: (e: NodeJS.ErrnoException | null, a?: unknown) => void) => void)("x.example", { all: true }, (error, address) => resolve({ error, address })),
    );

  it("blocks a public-looking name that resolves to a private address", async () => {
    for (const address of ["127.0.0.1", "10.0.0.7", "169.254.169.254", "::1", "192.168.1.1"]) {
      const res = await run(lookupFor([{ address, family: address.includes(":") ? 6 : 4 }]));
      expect(res.error?.code, address).toBe("EBLOCKED");
    }
  });

  it("blocks if ANY resolved address is private (mixed answers)", async () => {
    const res = await run(lookupFor([{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]));
    expect(res.error?.code).toBe("EBLOCKED");
  });

  it("allows a normal public address", async () => {
    const res = await run(lookupFor([{ address: "104.21.94.59", family: 4 }]));
    expect(res.error).toBeNull();
  });
});
