import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkDomainStatus } from "@/lib/preview/domain-status";
import { endOfDayBrussels, previewState, resolveExpiry } from "@/lib/preview/expiry";
import { previewCreateSchema, previewDetailsSchema } from "@/lib/schemas/preview";
import { escapeHtml, safeNextPath } from "@/lib/preview/pages";

const valid = {
  clientName: "Geert Kips",
  projectName: "Geert Kips Website",
  subdomain: "geertkips",
  targetUrl: "https://geertkips-concept.example-workers.dev",
  expiry: { kind: "never" },
  sessionTtlHours: 168,
  notes: "",
};

describe("preview form schema", () => {
  it("accepts a valid preview and normalises the subdomain", () => {
    const parsed = previewDetailsSchema.safeParse({ ...valid, subdomain: "  GeertKips " });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.subdomain).toBe("geertkips");
  });

  it("reports field-level errors for bad subdomains and targets (SSRF)", () => {
    const paths = (v: object) => {
      const r = previewDetailsSchema.safeParse({ ...valid, ...v });
      return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    };
    expect(paths({ subdomain: "foo.bar" })).toContain("subdomain");
    expect(paths({ subdomain: "www" })).toContain("subdomain");
    expect(paths({ targetUrl: "http://127.0.0.1" })).toContain("targetUrl");
    expect(paths({ targetUrl: "http://169.254.169.254/latest/meta-data" })).toContain("targetUrl");
    expect(paths({ targetUrl: "https://192.168.1.10" })).toContain("targetUrl");
    expect(paths({ targetUrl: "javascript:alert(1)" })).toContain("targetUrl");
    expect(paths({ targetUrl: "https://ianverlinden.com" })).toContain("targetUrl");
    expect(paths({ clientName: "" })).toContain("clientName");
    expect(paths({ sessionTtlHours: 5 })).toContain("sessionTtlHours");
  });

  it("requires a strong access code on create", () => {
    expect(previewCreateSchema.safeParse({ ...valid, code: "GK-7F3K-9MQX-P4TD" }).success).toBe(true);
    for (const code of ["", "short", "1234567890", "aaaaaaaaaaaa"]) {
      expect(previewCreateSchema.safeParse({ ...valid, code }).success, code).toBe(false);
    }
  });

  it("stores names verbatim (React escapes them) and keeps markup out of generated HTML", () => {
    const evil = '<img src=x onerror=alert(1)>"';
    expect(previewDetailsSchema.safeParse({ ...valid, clientName: evil }).success).toBe(true);
    expect(escapeHtml(evil)).not.toContain("<img");
    expect(safeNextPath('/x"><script>')).toBe('/x"><script>'); // allowed as a path; escaped where printed
    expect(escapeHtml(safeNextPath('/x"><script>'))).not.toContain("<script>");
  });
});

describe("expiry", () => {
  const now = new Date("2026-11-01T10:00:00Z");

  it("resolves presets relative to now and leaves 'keep' unchanged", () => {
    expect(resolveExpiry({ kind: "never" }, now)).toBeNull();
    expect(resolveExpiry({ kind: "keep" }, now)).toBeUndefined();
    expect(resolveExpiry({ kind: "days", days: 7 }, now)).toBe("2026-11-08T10:00:00.000Z");
    expect(resolveExpiry({ kind: "days", days: 30 }, now)).toBe("2026-12-01T10:00:00.000Z");
  });

  it("ends a custom date at 23:59:59 Brussels time, in winter and summer", () => {
    expect(endOfDayBrussels("2026-12-15")).toBe("2026-12-15T22:59:59.000Z"); // CET (UTC+1)
    expect(endOfDayBrussels("2026-07-15")).toBe("2026-07-15T21:59:59.000Z"); // CEST (UTC+2)
    expect(endOfDayBrussels("nope")).toBeNull();
    expect(resolveExpiry({ kind: "date", date: "2026-12-15" }, now)).toBe("2026-12-15T22:59:59.000Z");
  });

  it("derives state: active, disabled, expired", () => {
    expect(previewState({ active: true, expires_at: null }, now)).toBe("active");
    expect(previewState({ active: true, expires_at: "2026-11-02T00:00:00Z" }, now)).toBe("active");
    expect(previewState({ active: true, expires_at: "2026-11-01T09:59:59Z" }, now)).toBe("expired");
    expect(previewState({ active: false, expires_at: null }, now)).toBe("disabled");
    expect(previewState({ active: false, expires_at: "2020-01-01T00:00:00Z" }, now)).toBe("disabled");
  });
});

describe("domain status (never pretends DNS works)", () => {
  const answer = (marker: string | null) =>
    (async () => new Response("x", { headers: marker ? { "x-preview-gateway": marker } : {} })) as unknown as typeof fetch;

  it("is ready only when the hostname identifies itself as the gateway", async () => {
    expect(await checkDomainStatus("geertkips.ianverlinden.com", answer("1"))).toBe("ready");
    expect(await checkDomainStatus("geertkips.ianverlinden.com", answer(null))).toBe("elsewhere");
  });

  it("is pending when the hostname doesn't answer", async () => {
    const fail = (async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    expect(await checkDomainStatus("x.ianverlinden.com", fail)).toBe("pending");
  });

  it("only ever asks the hostname it was given, over https", async () => {
    const seen: string[] = [];
    const spy = (async (u: string) => (seen.push(u), new Response("x"))) as unknown as typeof fetch;
    await checkDomainStatus("geertkips.ianverlinden.com", spy);
    expect(seen).toEqual(["https://geertkips.ianverlinden.com/robots.txt"]);
  });
});

describe("browser safety of shared modules", () => {
  it("keeps everything the client form imports free of Node built-ins (they cannot be bundled for the browser)", () => {
    for (const file of [
      "src/lib/preview/target-url.ts", "src/lib/preview/subdomain.ts", "src/lib/preview/access-code.ts",
      "src/lib/preview/expiry.ts", "src/lib/schemas/preview.ts",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/from\s+["'](node:|fs["']|net["']|crypto["']|dns["']|https?["'])/);
    }
  });
});
