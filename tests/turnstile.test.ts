import { describe, expect, it, vi } from "vitest";
import { isTurnstileEnforced, verifyTurnstile } from "@/lib/turnstile";

const reply = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

describe("Turnstile verification", () => {
  it("is not enforced without a secret (local development)", async () => {
    expect(isTurnstileEnforced("")).toBe(false);
    expect(isTurnstileEnforced(undefined)).toBe(false);
    const fetchImpl = reply({ success: true });
    expect(await verifyTurnstile(undefined, "1.2.3.4", { secret: "", fetchImpl })).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a missing, empty or oversized token without calling Cloudflare", async () => {
    const fetchImpl = reply({ success: true });
    for (const token of [undefined, null, "", 42, "x".repeat(2049)]) {
      expect(await verifyTurnstile(token, undefined, { secret: "s", fetchImpl })).toBe("failed");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a token Cloudflare approves and sends secret, token and ip as a form body", async () => {
    const fetchImpl = reply({ success: true });
    expect(await verifyTurnstile("tok", "9.9.9.9", { secret: "sekret", fetchImpl })).toBe("ok");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("sekret");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("9.9.9.9");
  });

  it("rejects a token Cloudflare refuses", async () => {
    expect(
      await verifyTurnstile("tok", undefined, { secret: "s", fetchImpl: reply({ success: false }) }),
    ).toBe("failed");
  });

  it("fails closed when Cloudflare is unreachable or errors", async () => {
    const down = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await verifyTurnstile("tok", undefined, { secret: "s", fetchImpl: down })).toBe("unavailable");
    expect(
      await verifyTurnstile("tok", undefined, { secret: "s", fetchImpl: reply({}, false) }),
    ).toBe("unavailable");
  });
});
