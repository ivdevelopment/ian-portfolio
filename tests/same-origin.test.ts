import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "@/lib/same-origin";

describe("isSameOriginRequest", () => {
  it("accepts a matching origin and a missing one", () => {
    expect(isSameOriginRequest("https://site.com", "site.com")).toBe(true);
    expect(isSameOriginRequest(null, "site.com")).toBe(true);
  });

  it("rejects other origins and malformed values", () => {
    expect(isSameOriginRequest("https://evil.com", "site.com")).toBe(false);
    expect(isSameOriginRequest("https://site.com.evil.com", "site.com")).toBe(false);
    expect(isSameOriginRequest("not a url", "site.com")).toBe(false);
    expect(isSameOriginRequest("https://site.com", null)).toBe(false);
  });
});
