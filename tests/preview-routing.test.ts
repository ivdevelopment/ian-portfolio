import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { config as proxyConfig, proxy } from "@/proxy";

const call = (url: string, host = new URL(url).host, cookie?: string) =>
  proxy(new NextRequest(url, { headers: { host, ...(cookie ? { cookie } : {}) } }));

const rewriteTarget = (res: Response) => res.headers.get("x-middleware-rewrite");

afterEach(() => vi.unstubAllEnvs());

describe("proxy: preview hostnames go to the gateway", () => {
  it("routes <name>.ianverlinden.com to the internal gateway path, whatever the path", async () => {
    for (const [url, expected] of [
      ["https://geertkips.ianverlinden.com/", "/gw-preview"],
      ["https://foo.ianverlinden.com/", "/gw-preview"],
      ["https://geertkips.ianverlinden.com/about", "/gw-preview/about"],
      ["https://geertkips.ianverlinden.com/api/contact", "/gw-preview/api/contact"],
      ["https://geertkips.ianverlinden.com/_next/static/chunks/a.js", "/gw-preview/_next/static/chunks/a.js"],
      ["https://geertkips.ianverlinden.com/images/hero.webp?v=2", "/gw-preview/images/hero.webp"],
      ["https://geertkips.ianverlinden.com/admin", "/gw-preview/admin"],
      ["https://geertkips.ianverlinden.com/en/work", "/gw-preview/en/work"],
      ["https://geertkips.ianverlinden.com/__preview/login", "/gw-preview/__preview/login"],
    ] as const) {
      const res = await call(url);
      expect(rewriteTarget(res), url).toContain(`https://geertkips.ianverlinden.com${expected}`.replace("geertkips", new URL(url).host.split(".")[0]));
    }
  });

  it("keeps the query string", async () => {
    expect(rewriteTarget(await call("https://geertkips.ianverlinden.com/p?x=1&y=2"))).toContain("/gw-preview/p?x=1&y=2");
  });
});

describe("proxy: the main portfolio is unaffected", () => {
  it("serves the apex and www exactly as before (Dutch rewrite, English pass-through, redirects)", async () => {
    for (const host of ["ianverlinden.com", "www.ianverlinden.com"]) {
      expect(rewriteTarget(await call(`https://${host}/`, host))).toBe(`https://${host}/nl`);
      expect(rewriteTarget(await call(`https://${host}/contact`, host))).toBe(`https://${host}/nl/contact`);
      const en = await call(`https://${host}/en/contact`, host);
      expect(rewriteTarget(en)).toBeNull();
      expect(en.headers.get("x-middleware-next")).toBe("1");
      const nl = await call(`https://${host}/nl/about`, host);
      expect(nl.status).toBe(308);
      expect(nl.headers.get("location")).toBe(`https://${host}/about`);
    }
  });

  it("leaves static files, API routes and OG images alone, even though the second matcher also sees non-preview hosts", async () => {
    for (const path of ["/favicon.ico", "/media/a.png", "/robots.txt", "/sitemap.xml", "/api/contact", "/_next/static/x.js", "/og/nl"]) {
      const res = await call(`https://www.ianverlinden.com${path}`, "www.ianverlinden.com");
      expect(rewriteTarget(res), path).toBeNull();
      expect(res.status, path).toBe(200);
    }
  });

  it("keeps /admin guarded (redirects visitors without a session to login) on the main host", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const res = await call("https://ianverlinden.com/admin", "ianverlinden.com");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://ianverlinden.com/admin/login");
  });

  it("does not hijack reserved or look-alike hosts", async () => {
    for (const host of ["admin.ianverlinden.com", "api.ianverlinden.com", "mail.ianverlinden.com", "en.ianverlinden.com", "evilianverlinden.com", "ianverlinden.com.evil.com", "a.b.ianverlinden.com"]) {
      const res = await call(`https://${host}/`, host);
      expect(rewriteTarget(res)?.includes("/gw-preview"), host).toBeFalsy();
    }
  });

  it("only honours <name>.localhost outside production", async () => {
    expect(rewriteTarget(await call("http://demo.localhost:3000/", "demo.localhost:3000"))).toContain("/gw-preview");
    vi.stubEnv("NODE_ENV", "production");
    expect(rewriteTarget(await call("http://demo.localhost:3000/", "demo.localhost:3000"))?.includes("/gw-preview")).toBeFalsy();
  });
});

describe("dedicated gateway deployment (PREVIEW_GATEWAY_ONLY=1)", () => {
  it("answers 404 for everything that is not a preview host, and still serves previews", async () => {
    vi.stubEnv("PREVIEW_GATEWAY_ONLY", "1");
    for (const host of ["ianverlinden.com", "www.ianverlinden.com", "my-gateway-abc.vercel.app"]) {
      expect((await call(`https://${host}/`, host)).status, host).toBe(404);
    }
    expect(rewriteTarget(await call("https://geertkips.ianverlinden.com/", "geertkips.ianverlinden.com"))).toContain("/gw-preview");
  });
});

describe("static configuration", () => {
  const HOST_PATTERN = "(?!www\\.)[a-z0-9-]+\\.(ianverlinden\\.com|localhost)";

  it("matches preview hosts only (and runs the proxy for the main site as before)", () => {
    const entries = proxyConfig.matcher as Array<string | { source: string; has?: Array<{ type: string; value: string }> }>;
    const hostRule = entries.find((e): e is Exclude<typeof e, string> => typeof e !== "string")!;
    expect(hostRule.has![0]).toEqual({ type: "host", value: HOST_PATTERN });
    const re = new RegExp(`^${HOST_PATTERN}$`);
    for (const ok of ["geertkips.ianverlinden.com", "x.ianverlinden.com", "demo.localhost"]) expect(re.test(ok), ok).toBe(true);
    for (const no of ["www.ianverlinden.com", "ianverlinden.com", "evil.com", "a.b.ianverlinden.com"]) expect(re.test(no), no).toBe(false);
  });

  it("uses the same host pattern to keep the portfolio's CSP and headers off preview hosts", () => {
    const next = readFileSync("next.config.ts", "utf8");
    const literal = `missing: [{ type: "host", value: "${HOST_PATTERN.replace(/\\/g, "\\\\")}" }]`;
    // Once for the security headers, once for the gateway-only catch-all rewrite.
    expect(next.split(literal).length - 1).toBe(2);
  });
});
