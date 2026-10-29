import { describe, expect, it } from "vitest";
import { isFramingAllowed, isProbeableUrl } from "@/lib/embed-policy";

const ours = "https://portfolio.example";

describe("isFramingAllowed", () => {
  it("allows sites that set no framing policy", () => {
    expect(isFramingAllowed({}, ours)).toBe(true);
    expect(isFramingAllowed({ contentSecurityPolicy: "default-src 'self'" }, ours)).toBe(true);
  });

  it("blocks X-Frame-Options DENY / SAMEORIGIN", () => {
    expect(isFramingAllowed({ xFrameOptions: "DENY" }, ours)).toBe(false);
    expect(isFramingAllowed({ xFrameOptions: "sameorigin" }, ours)).toBe(false);
  });

  it("honours frame-ancestors", () => {
    expect(isFramingAllowed({ contentSecurityPolicy: "frame-ancestors 'none'" }, ours)).toBe(false);
    expect(isFramingAllowed({ contentSecurityPolicy: "default-src 'self'; frame-ancestors 'self'" }, ours)).toBe(false);
    expect(isFramingAllowed({ contentSecurityPolicy: "frame-ancestors https://other.example" }, ours)).toBe(false);
    expect(isFramingAllowed({ contentSecurityPolicy: "frame-ancestors *" }, ours)).toBe(true);
    expect(isFramingAllowed({ contentSecurityPolicy: `frame-ancestors ${ours}` }, ours)).toBe(true);
    expect(isFramingAllowed({ contentSecurityPolicy: "frame-ancestors https:" }, ours)).toBe(true);
  });

  it("requires every comma-joined policy to allow framing", () => {
    expect(
      isFramingAllowed({ contentSecurityPolicy: "frame-ancestors *, frame-ancestors 'none'" }, ours),
    ).toBe(false);
  });
});

describe("isProbeableUrl", () => {
  it("probes only public https sites", () => {
    expect(isProbeableUrl("https://example.com/path")).toBe(true);
    for (const u of [
      "http://example.com",
      "https://localhost:3000",
      "https://127.0.0.1",
      "https://192.168.1.5",
      "https://[::1]/",
      "https://printer.local",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isProbeableUrl(u)).toBe(false);
    }
  });
});
