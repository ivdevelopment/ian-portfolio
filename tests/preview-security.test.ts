import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, GENERATED_CODE_BITS, codePrefix, generateAccessCode, validateAccessCode } from "@/lib/preview/access-code";
import { getPreviewConfig } from "@/lib/preview/config";
import { parsePreviewHost } from "@/lib/preview/hostname";
import { isPrivateAddress } from "@/lib/preview/ip-safety";
import {
  clearSessionCookie,
  readCookie,
  serializeSessionCookie,
  sessionCookieName,
  sessionExpiry,
  signSession,
  verifySession,
  type SessionPayload,
} from "@/lib/preview/session";
import { RESERVED_SUBDOMAINS, validateSubdomain } from "@/lib/preview/subdomain";
import { validateTargetUrl } from "@/lib/preview/target-url";

describe("subdomain validation", () => {
  it("accepts a single valid lowercase label", () => {
    for (const ok of ["geertkips", "a", "client-1", "a1b2", "x".repeat(63)]) {
      expect(validateSubdomain(ok)).toEqual({ ok: true, value: ok });
    }
  });

  it("rejects dots, uppercase, bad characters and edge hyphens", () => {
    for (const bad of ["foo.bar", "Foo", "-foo", "foo-", "foo_bar", "foo bar", "foo/bar", "fö", "", "x".repeat(64), "ab--cd", "a@b"]) {
      expect(validateSubdomain(bad).ok, bad).toBe(false);
    }
  });

  it("rejects every reserved name", () => {
    for (const name of ["www", "admin", "api", "mail", "en", "nl", "review", "reviews", "work", "contact", "about", "services"]) {
      expect(RESERVED_SUBDOMAINS).toContain(name);
      expect(validateSubdomain(name).ok, name).toBe(false);
    }
  });
});

describe("target URL (SSRF guard)", () => {
  const ok = (url: string) => validateTargetUrl(url, { blockedDomains: ["ianverlinden.com"] });

  it("accepts a public https site root and normalises it", () => {
    expect(ok("https://geertkips-concept.example-workers.dev")).toMatchObject({ ok: true, origin: "https://geertkips-concept.example-workers.dev" });
    expect(ok("  https://Client-Site.vercel.app/ ")).toMatchObject({ ok: true, value: "https://client-site.vercel.app" });
    expect(ok("https://client-site.vercel.app.")).toMatchObject({ ok: true, hostname: "client-site.vercel.app" });
  });

  it("rejects the dangerous schemes and malformed input", () => {
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "ftp://example.com", "http://example.com", "//example.com", "example.com", "", "not a url", "https://", "https://exa mple.com", "https://example.com\\@evil.com"]) {
      expect(ok(bad).ok, bad).toBe(false);
    }
  });

  it("rejects localhost, private and metadata addresses in every notation", () => {
    for (const bad of [
      "https://localhost", "https://localhost:3000", "https://app.localhost", "https://127.0.0.1", "https://127.1",
      "https://2130706433", "https://0x7f000001", "https://0177.0.0.1", "https://0.0.0.0",
      "https://10.0.0.5", "https://172.16.0.1", "https://192.168.1.1", "https://169.254.169.254",
      "https://[::1]", "https://[::ffff:127.0.0.1]", "https://[fd00::1]", "https://[fe80::1]", "https://8.8.8.8",
      "https://metadata.google.internal", "https://printer.local", "https://router.lan", "https://intranet", "https://server.home.arpa",
      "https://a.test", "https://a.invalid", "https://x.example",
    ]) {
      expect(ok(bad).ok, bad).toBe(false);
    }
  });

  it("rejects credentials, odd ports, paths, queries and fragments", () => {
    for (const bad of ["https://user:pw@example.com", "https://user@example.com", "https://example.com:8443", "https://example.com/app", "https://example.com/?x=1", "https://example.com/#x"]) {
      expect(ok(bad).ok, bad).toBe(false);
    }
    expect(ok("https://example.com:443")).toMatchObject({ ok: true });
  });

  it("refuses to point back at this site or the preview domain", () => {
    for (const bad of ["https://ianverlinden.com", "https://www.ianverlinden.com", "https://other.ianverlinden.com"]) {
      expect(ok(bad).ok, bad).toBe(false);
    }
    expect(ok("https://notianverlinden.com").ok).toBe(true);
  });
});

describe("private address detection (checked at connection time)", () => {
  it("blocks private, loopback, link-local, metadata and reserved ranges", () => {
    for (const ip of [
      "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.5", "172.31.255.255",
      "192.168.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fc00::1", "fd12:3456::1",
      "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:db8::1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public addresses and rejects non-IPs", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "104.21.94.59", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
    expect(isPrivateAddress("example.com")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("access codes", () => {
  it("generates memorable, unpredictable, high-entropy codes", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateAccessCode("Geert Kips")));
    expect(codes.size).toBe(200);
    for (const code of codes) {
      expect(code).toMatch(/^GK-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect([...code.replace(/-/g, "").slice(2)].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
      expect(validateAccessCode(code).ok).toBe(true);
    }
    expect(GENERATED_CODE_BITS).toBeGreaterThanOrEqual(55);
  });

  it("never emits look-alike characters", () => {
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it("uses the injected randomness without modulo bias and derives a prefix from the name", () => {
    const zero = generateAccessCode("Ångström Ünal", (n) => n.fill(0));
    expect(zero).toBe("AU-AAAA-AAAA-AAAA");
    expect(codePrefix("Geert Kips")).toBe("GK");
    expect(codePrefix("12345")).toBe("PV");
    expect(codePrefix("a b c d e")).toBe("ABC");
  });

  it("rejects weak manual codes and accepts reasonable ones", () => {
    for (const bad of ["", "short", "1234567890", "aaaaaaaaaaaa", "x".repeat(129), "      "]) {
      expect(validateAccessCode(bad).ok, bad).toBe(false);
    }
    expect(validateAccessCode("  Zomer-Preview-26  ")).toEqual({ ok: true, value: "Zomer-Preview-26" });
  });
});

describe("preview sessions", () => {
  const secret = "s".repeat(40);
  const now = new Date("2026-11-01T10:00:00Z");
  const payload: SessionPayload = {
    pid: "11111111-1111-4111-8111-111111111111",
    sub: "geertkips",
    ver: 3,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 3600,
  };
  const expected = { pid: payload.pid, sub: payload.sub, ver: 3 };

  it("round-trips a valid session and never contains the access code", () => {
    const token = signSession(payload, secret);
    expect(token).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(verifySession(token, secret, expected, now)).toEqual({ ok: true, payload });
  });

  it("rejects tampering with the payload or the signature", () => {
    const [v, body, sig] = signSession(payload, secret).split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, ver: 4, pid: "22222222-2222-4222-8222-222222222222" })).toString("base64url");
    expect(verifySession(`${v}.${forged}.${sig}`, secret, expected, now)).toEqual({ ok: false, reason: "signature" });
    expect(verifySession(`${v}.${body}.${sig.slice(0, -2)}AA`, secret, expected, now)).toMatchObject({ ok: false });
    expect(verifySession(signSession(payload, secret), "t".repeat(40), expected, now)).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects malformed tokens", () => {
    for (const t of [undefined, "", "garbage", "v1.a", "v2.a.b", "v1..", "x".repeat(2000)]) {
      expect(verifySession(t, secret, expected, now).ok, String(t)).toBe(false);
    }
  });

  it("expires", () => {
    const token = signSession(payload, secret);
    expect(verifySession(token, secret, expected, new Date(now.getTime() + 3599_000)).ok).toBe(true);
    expect(verifySession(token, secret, expected, new Date(now.getTime() + 3600_000))).toEqual({ ok: false, reason: "expired" });
  });

  it("is bound to one preview, one subdomain and one session generation", () => {
    const token = signSession(payload, secret);
    expect(verifySession(token, secret, { ...expected, pid: "22222222-2222-4222-8222-222222222222" }, now)).toEqual({ ok: false, reason: "preview" });
    expect(verifySession(token, secret, { ...expected, sub: "anotherclient" }, now)).toEqual({ ok: false, reason: "preview" });
    expect(verifySession(token, secret, { ...expected, ver: 4 }, now)).toEqual({ ok: false, reason: "version" });
  });

  it("refuses to sign with a weak secret", () => {
    expect(() => signSession(payload, "short")).toThrow();
  });

  it("caps the session at the preview's own expiry", () => {
    const base = Math.floor(now.getTime() / 1000);
    expect(sessionExpiry(now, 24, null)).toBe(base + 86400);
    expect(sessionExpiry(now, 24, "2026-11-01T11:00:00Z")).toBe(base + 3600);
    expect(sessionExpiry(now, 24, "2027-01-01T00:00:00Z")).toBe(base + 86400);
  });

  it("sets a host-bound, HttpOnly, Secure, SameSite=Lax cookie", () => {
    const name = sessionCookieName(true);
    expect(name).toBe("__Host-pv_session");
    const cookie = serializeSessionCookie(name, "tok", 3600, true);
    expect(cookie).toBe("__Host-pv_session=tok; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax; Secure");
    expect(cookie).not.toMatch(/Domain=/i);
    expect(clearSessionCookie(name, true)).toContain("Max-Age=0");
    expect(sessionCookieName(false)).toBe("pv_session");
    expect(serializeSessionCookie("pv_session", "t", 60, false)).not.toContain("Secure");
  });

  it("reads one cookie out of a header", () => {
    expect(readCookie("a=1; __Host-pv_session=abc; b=2", "__Host-pv_session")).toBe("abc");
    expect(readCookie("a=1", "__Host-pv_session")).toBeUndefined();
    expect(readCookie(null, "x")).toBeUndefined();
  });
});

describe("hostname parsing (Host header is untrusted)", () => {
  const opts = { baseDomain: "ianverlinden.com" };

  it("extracts the subdomain of a preview host", () => {
    expect(parsePreviewHost("geertkips.ianverlinden.com", opts)).toBe("geertkips");
    expect(parsePreviewHost("foo.ianverlinden.com", opts)).toBe("foo");
    expect(parsePreviewHost("GeertKips.IanVerlinden.com:443", opts)).toBe("geertkips");
    expect(parsePreviewHost("geertkips.ianverlinden.com.", opts)).toBe("geertkips");
  });

  it("never treats the main site as a preview host", () => {
    for (const host of ["ianverlinden.com", "www.ianverlinden.com", "admin.ianverlinden.com", "api.ianverlinden.com", "mail.ianverlinden.com", "en.ianverlinden.com"]) {
      expect(parsePreviewHost(host, opts), host).toBeNull();
    }
  });

  it("rejects malformed and manipulated hosts", () => {
    for (const host of [
      null, undefined, "", "a.b.ianverlinden.com", "evil.com", "ianverlinden.com.evil.com", "geertkips.ianverlinden.com.evil.com",
      "evilianverlinden.com", "x.ianverlinden.co", "geertkips.ianverlinden.com@evil.com", "geertkips.ianverlinden.com/", "geertkips .ianverlinden.com",
      "geertkips.ianverlinden.com:99999999", "geertkips.ianverlinden.com,evil.com", "[::1]", "127.0.0.1", "-bad.ianverlinden.com", "x".repeat(300),
      "gé.ianverlinden.com", "geertkips.ianverlinden.com:abc",
    ]) {
      expect(parsePreviewHost(host as string, opts), String(host)).toBeNull();
    }
  });

  it("only honours <name>.localhost outside production", () => {
    expect(parsePreviewHost("demo.localhost:3000", { baseDomain: "ianverlinden.com", allowLocalhost: true })).toBe("demo");
    expect(parsePreviewHost("demo.localhost:3000", opts)).toBeNull();
    expect(parsePreviewHost("localhost:3000", { baseDomain: "ianverlinden.com", allowLocalhost: true })).toBeNull();
  });
});

describe("configuration", () => {
  it("fails closed when secrets are missing or too short", () => {
    expect(getPreviewConfig({}).sessionSecret).toBeNull();
    expect(getPreviewConfig({ PREVIEW_SESSION_SECRET: "short" }).sessionSecret).toBeNull();
    expect(getPreviewConfig({ PREVIEW_SESSION_SECRET: "s".repeat(32), PREVIEW_IP_HASH_SALT: "x".repeat(16) })).toMatchObject({
      sessionSecret: "s".repeat(32),
      ipSalt: "x".repeat(16),
    });
  });

  it("defaults to ianverlinden.com, rejects a bad base domain, and enables localhost only outside production", () => {
    expect(getPreviewConfig({}).baseDomain).toBe("ianverlinden.com");
    expect(getPreviewConfig({ PREVIEW_BASE_DOMAIN: "evil.com/x" }).baseDomain).toBe("ianverlinden.com");
    expect(getPreviewConfig({ PREVIEW_BASE_DOMAIN: "Example.org" }).baseDomain).toBe("example.org");
    expect(getPreviewConfig({ NODE_ENV: "production" }).allowLocalhost).toBe(false);
    expect(getPreviewConfig({ NODE_ENV: "development" }).allowLocalhost).toBe(true);
  });
});
