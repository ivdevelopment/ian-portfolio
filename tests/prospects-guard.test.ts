import { describe, expect, it } from "vitest";
import { isSameOrigin } from "@/lib/prospects/request-guard";

const request = (headers: Record<string, string>, url = "https://ianverlinden.com/admin/prospects/export") => new Request(url, { method: "POST", headers });

describe("same-origin guard for the admin export/import endpoints", () => {
  it("accepts the admin's own origin", () => {
    expect(isSameOrigin(request({ origin: "https://ianverlinden.com", host: "ianverlinden.com" }))).toBe(true);
  });
  it("rejects another site, a look-alike host and a malformed origin", () => {
    expect(isSameOrigin(request({ origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(request({ origin: "https://ianverlinden.com.evil.example" }))).toBe(false);
    expect(isSameOrigin(request({ origin: "null" }))).toBe(false);
  });
  it("without an Origin header it relies on Fetch-Metadata: cross-site is refused", () => {
    expect(isSameOrigin(request({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOrigin(request({ "sec-fetch-site": "same-origin" }))).toBe(true);
  });
});
