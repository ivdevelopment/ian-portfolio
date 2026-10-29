import { describe, expect, it, vi } from "vitest";
import { processReviewSubmission } from "@/lib/review-submit";
import { generateReviewToken } from "@/lib/review-tokens";
import * as route from "@/app/api/reviews/submit/route";

// The real client module is server-only and never used here: the database call is injected.
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => ({ rpc: vi.fn() }) }));

const token = generateReviewToken();
const values = { name: "Test Client", company: "", role: "", rating: 5, review: "A genuinely good experience working together on this.", website: "" };

const rpcReturning = (data: unknown, error: { code?: string } | null = null) =>
  vi.fn(async () => ({ data, error }));

describe("processReviewSubmission", () => {
  it("submits a valid review and sends only the token HASH to the database", async () => {
    const rpc = rpcReturning("ok");
    expect(await processReviewSubmission(token, values, 9000, "1.2.3.4", rpc)).toEqual({ status: "submitted" });
    const args = JSON.stringify(rpc.mock.calls[0]);
    expect(args).not.toContain(token);
    expect(args).toContain("p_token_hash");
  });

  it("gives the same generic answer for unknown, used, expired and revoked links", async () => {
    for (const dbAnswer of ["invalid", "used", "expired", "revoked", "anything-else"]) {
      expect(await processReviewSubmission(token, values, 9000, "ip", rpcReturning(dbAnswer))).toEqual({ status: "invalid-link" });
    }
  });

  it("rejects an implausible token without calling the database", async () => {
    const rpc = rpcReturning("ok");
    for (const bad of [undefined, 5, "", "short", "x".repeat(500)]) {
      expect(await processReviewSubmission(bad, values, 9000, "ip", rpc)).toEqual({ status: "invalid-link" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports invalid input with field errors", async () => {
    const rpc = rpcReturning("ok");
    const result = await processReviewSubmission(token, { ...values, rating: 0, name: "" }, 9000, "ip", rpc);
    expect(result.status).toBe("invalid-input");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores nothing for a filled honeypot or a too-fast submission", async () => {
    const rpc = rpcReturning("ok");
    // The schema itself refuses a filled honeypot (existing behaviour), so it never reaches the database.
    expect((await processReviewSubmission(token, { ...values, website: "http://spam" }, 9000, "ip", rpc)).status).not.toBe("submitted");
    expect((await processReviewSubmission(token, values, 100, "ip", rpc)).status).toBe("error");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps rate limiting and database errors to safe messages without internals", async () => {
    const limited = await processReviewSubmission(token, values, 9000, "ip", rpcReturning("rate_limited"));
    expect(limited).toMatchObject({ status: "error" });
    const failed = await processReviewSubmission(token, values, 9000, "ip", rpcReturning(null, { code: "XX000" }));
    expect(JSON.stringify(failed)).not.toMatch(/XX000|relation|supabase/i);
  });
});

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  route.POST(new Request("http://site.test/api/reviews/submit", { method: "POST", body, headers: { "content-type": "application/json", host: "site.test", ...headers } }));

describe("POST /api/reviews/submit", () => {
  it("only exposes POST", () => {
    expect(Object.keys(route)).toEqual(["POST"]);
  });

  it("rejects empty, malformed, non-object, wrong-type and oversized bodies as 400 no-store JSON", async () => {
    const cases: [BodyInit | null, Record<string, string>?][] = [
      [""],
      ["{nope"],
      ["[1,2]"],
      ['{"a":1}', { "content-type": "text/plain" }],
      [JSON.stringify({ pad: "x".repeat(20000) })],
    ];
    for (const [body, headers] of cases) {
      const res = await post(body, headers);
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toMatchObject({ status: "error" });
    }
  });

  it("rejects cross-origin requests with 403", async () => {
    const res = await post("{}", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers invalid data with JSON and never echoes the token", async () => {
    const res = await post(JSON.stringify({ token, values: { name: "" }, elapsedMs: 9000 }), { origin: "http://site.test" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text).status).toBe("invalid-input");
    expect(text).not.toContain(token);
  });

  it("returns the generic invalid-link answer for a bad token", async () => {
    const res = await post(JSON.stringify({ token: "bad", values, elapsedMs: 9000 }));
    expect(await res.json()).toEqual({ status: "invalid-link" });
  });
});
