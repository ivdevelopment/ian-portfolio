import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ZohoMailClient, createTokenSource } from "@/lib/mail/zoho/client";
import { ZOHO_READ_SCOPES, getZohoConfig, type ZohoConfig } from "@/lib/mail/zoho/config";
import { createOAuthState, decryptToken, encryptToken, verifyOAuthState } from "@/lib/mail/zoho/crypto";
import { buildProspectIndex, matchProspect } from "@/lib/mail/zoho/match";
import { htmlToSafeText, normalizeAddress, parseAddressList, toMailRecord } from "@/lib/mail/zoho/normalize";
import { ZohoError, buildAuthorizationUrl, exchangeCode, refreshAccessToken, revokeRefreshToken } from "@/lib/mail/zoho/oauth";
import { incrementalStart, runSync, zohoSearchDate, type MailStore } from "@/lib/mail/zoho/sync";
import { lastEmail, mergeTimeline, suggestReply, type MailRow } from "@/lib/mail/timeline";
import type { ActivityRecord } from "@/lib/prospects/types";

/* No test below talks to Zoho: every network call is a mock. */

const KEY = randomBytes(32);
const baseEnv = {
  ZOHO_MAIL_ENABLED: "1",
  ZOHO_CLIENT_ID: "cid",
  ZOHO_CLIENT_SECRET: "csecret",
  ZOHO_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"),
  NEXT_PUBLIC_SITE_URL: "https://ianverlinden.com",
  ZOHO_SMTP_USER: "hello@ianverlinden.com",
};
const config = (over: Record<string, string | undefined> = {}): ZohoConfig => getZohoConfig({ ...baseEnv, ...over });

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("configuration", () => {
  it("is off unless explicitly enabled and completely configured, and says why", () => {
    expect(getZohoConfig({}).enabled).toBe(false);
    expect(getZohoConfig({}).reason).toMatch(/not enabled/i);
    const partial = getZohoConfig({ ZOHO_MAIL_ENABLED: "1" });
    expect(partial.enabled).toBe(false);
    expect(partial.reason).toMatch(/ZOHO_CLIENT_ID/);
    expect(partial.reason).not.toMatch(/csecret/);
    expect(getZohoConfig({ ...baseEnv, ZOHO_TOKEN_ENCRYPTION_KEY: "short" }).enabled).toBe(false);
    expect(config().enabled).toBe(true);
  });

  it("defaults to the EU data center (not .com) and keeps the data center configurable", () => {
    expect(config()).toMatchObject({ dataCenter: "eu", accountsUrl: "https://accounts.zoho.eu", mailUrl: "https://mail.zoho.eu" });
    expect(config({ ZOHO_DATA_CENTER: "com" }).accountsUrl).toBe("https://accounts.zoho.com");
    expect(config({ ZOHO_DATA_CENTER: "nonsense" }).dataCenter).toBe("eu");
    expect(config({ ZOHO_MAIL_API_URL: "https://mail.example.test/" }).mailUrl).toBe("https://mail.example.test");
  });

  it("derives the callback URL from the site URL and the mailbox from the existing SMTP user", () => {
    expect(config().redirectUri).toBe("https://ianverlinden.com/admin/settings/integrations/zoho/callback");
    expect(config().mailbox).toBe("hello@ianverlinden.com");
  });

  it("asks for the least privilege read-only needs", () => {
    expect([...ZOHO_READ_SCOPES]).toEqual(["ZohoMail.accounts.READ", "ZohoMail.messages.READ"]);
  });
});

describe("token storage boundary", () => {
  it("encrypts with a random IV, never stores the token in the clear, and decrypts back", () => {
    const a = encryptToken("1000.refresh.token", KEY);
    const b = encryptToken("1000.refresh.token", KEY);
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh");
    expect(a.startsWith("v1.")).toBe(true);
    expect(decryptToken(a, KEY)).toBe("1000.refresh.token");
  });
  it("refuses a tampered value, the wrong key and an unknown format", () => {
    const stored = encryptToken("secret", KEY);
    const [v, iv, tag, data] = stored.split(".");
    expect(() => decryptToken([v, iv, tag, `${data.slice(0, -2)}AA`].join("."), KEY)).toThrow();
    expect(() => decryptToken(stored, randomBytes(32))).toThrow();
    expect(() => decryptToken("v9.x.y.z", KEY)).toThrow(/unrecognised/);
    expect(() => encryptToken("x", randomBytes(16))).toThrow();
  });
});

describe("OAuth state (CSRF protection)", () => {
  const uid = "user-1";
  it("accepts the matching state for the same admin within the window", () => {
    const { state, cookie } = createOAuthState(uid, KEY, 1_000);
    expect(verifyOAuthState(cookie, state, uid, KEY, 2_000)).toEqual({ ok: true });
  });
  it("rejects a missing cookie or parameter, a wrong state, another admin, an expired attempt and a forged cookie", () => {
    const { state, cookie } = createOAuthState(uid, KEY, 1_000);
    expect(verifyOAuthState(undefined, state, uid, KEY)).toMatchObject({ ok: false, reason: "missing" });
    expect(verifyOAuthState(cookie, null, uid, KEY)).toMatchObject({ ok: false, reason: "missing" });
    expect(verifyOAuthState(cookie, "someone-elses-state-value-xxxxxxxxxxxx", uid, KEY, 2_000)).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifyOAuthState(cookie, state, "user-2", KEY, 2_000)).toMatchObject({ ok: false, reason: "wrong_user" });
    expect(verifyOAuthState(cookie, state, uid, KEY, 1_000 + 11 * 60_000)).toMatchObject({ ok: false, reason: "expired" });
    const [body] = cookie.split(".");
    expect(verifyOAuthState(`${body}.forgedsignature`, state, uid, KEY, 2_000)).toMatchObject({ ok: false, reason: "tampered" });
    expect(verifyOAuthState(cookie, state, uid, randomBytes(32), 2_000)).toMatchObject({ ok: false, reason: "tampered" });
  });
  it("issues a fresh state each time", () => {
    expect(createOAuthState(uid, KEY).state).not.toBe(createOAuthState(uid, KEY).state);
  });
});

describe("authorization URL and token exchange", () => {
  it("targets the EU accounts server with offline access and the read scopes", () => {
    const url = new URL(buildAuthorizationUrl(config(), "STATE123"));
    expect(url.origin + url.pathname).toBe("https://accounts.zoho.eu/oauth/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toBe("ZohoMail.accounts.READ,ZohoMail.messages.READ");
    expect(url.searchParams.get("state")).toBe("STATE123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://ianverlinden.com/admin/settings/integrations/zoho/callback");
    expect(url.searchParams.get("client_secret")).toBeNull();
  });

  it("exchanges a code at the EU token endpoint and returns the tokens", async () => {
    const f = vi.fn(async () => json({ access_token: "AT", refresh_token: "RT", expires_in: 3600, scope: "ZohoMail.accounts.READ ZohoMail.messages.READ", api_domain: "https://www.zohoapis.eu" }));
    const t = await exchangeCode(config(), "the-code", f as unknown as typeof fetch);
    expect(t).toMatchObject({ accessToken: "AT", refreshToken: "RT", expiresInSec: 3600 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://accounts.zoho.eu/oauth/v2/token");
    const body = (init.body as URLSearchParams).toString();
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=the-code");
  });

  it("treats Zoho's HTTP 200 + {error} answers as failures (invalid_code is an auth problem)", async () => {
    const f = vi.fn(async () => json({ error: "invalid_code" }));
    await expect(exchangeCode(config(), "bad", f as unknown as typeof fetch)).rejects.toMatchObject({ kind: "auth" });
    await expect(exchangeCode(config(), "x", (async () => json({ nothing: true })) as unknown as typeof fetch)).rejects.toMatchObject({ kind: "bad_response" });
    await expect(exchangeCode(config(), "x", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).rejects.toMatchObject({ kind: "network" });
  });

  it("refreshes an access token, and revokes best-effort", async () => {
    const f = vi.fn(async () => json({ access_token: "NEW", expires_in: 3600 }));
    expect((await refreshAccessToken(config(), "RT", f as unknown as typeof fetch)).accessToken).toBe("NEW");
    expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams).toString()).toContain("grant_type=refresh_token");
    expect(await revokeRefreshToken(config(), "RT", (async () => new Response("", { status: 200 })) as unknown as typeof fetch)).toBe(true);
    expect(await revokeRefreshToken(config(), "RT", (async () => { throw new Error("x"); }) as unknown as typeof fetch)).toBe(false);
  });
});

describe("access-token source", () => {
  it("caches until shortly before expiry, then refreshes; force refreshes immediately", async () => {
    let now = 0;
    const f = vi.fn(async () => json({ access_token: `T${f.mock.calls.length}`, expires_in: 3600 }));
    const get = createTokenSource(config(), "RT", f as unknown as typeof fetch, () => now);
    expect(await get()).toBe("T1");
    now = 30 * 60_000;
    expect(await get()).toBe("T1");
    now = 3600_000 - 30_000;
    expect(await get()).toBe("T2");
    expect(await get(true)).toBe("T3");
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe("Mail API client", () => {
  const client = (f: (url: URL, init: RequestInit) => Promise<Response>, tokens = ["A1", "A2"]) => {
    let i = 0;
    return new ZohoMailClient({ mailUrl: "https://mail.zoho.eu" }, async () => tokens[Math.min(i++, tokens.length - 1)], ((u: URL, init: RequestInit) => f(u, init)) as unknown as typeof fetch);
  };

  it("sends the Zoho-oauthtoken header to the configured host and unwraps the documented envelope", async () => {
    const seen: Array<{ url: string; auth: string }> = [];
    const c = client(async (url, init) => {
      seen.push({ url: url.toString(), auth: (init.headers as Record<string, string>).Authorization });
      return json({ status: { code: 200 }, data: [{ accountId: 123, primaryEmailAddress: "Hello@IanVerlinden.com" }] });
    });
    expect(await c.getAccounts()).toEqual([{ accountId: "123", primaryEmail: "hello@ianverlinden.com" }]);
    expect(seen[0]).toEqual({ url: "https://mail.zoho.eu/api/accounts", auth: "Zoho-oauthtoken A1" });
  });

  it("retries once with a forced token refresh on 401, then reports an auth error", async () => {
    let calls = 0;
    const ok = client(async () => (++calls === 1 ? new Response("", { status: 401 }) : json({ data: [] })));
    expect(await ok.getAccounts()).toEqual([]);
    expect(calls).toBe(2);
    const bad = client(async () => new Response("", { status: 401 }));
    await expect(bad.getAccounts()).rejects.toMatchObject({ kind: "auth" });
  });

  it("maps throttling, outages and nonsense to typed errors", async () => {
    await expect(client(async () => new Response("", { status: 429, headers: { "retry-after": "7" } })).getAccounts()).rejects.toMatchObject({ kind: "rate_limit", retryAfterMs: 7000 });
    await expect(client(async () => new Response("Too many requests", { status: 403 })).getAccounts()).rejects.toMatchObject({ kind: "rate_limit" });
    await expect(client(async () => new Response("Forbidden", { status: 403 })).getAccounts()).rejects.toMatchObject({ kind: "auth" });
    await expect(client(async () => new Response("", { status: 503 })).getAccounts()).rejects.toMatchObject({ kind: "provider" });
    await expect(client(async () => json({ unexpected: true })).getAccounts()).rejects.toMatchObject({ kind: "bad_response" });
    await expect(client(async () => { throw new Error("offline"); }).getAccounts()).rejects.toMatchObject({ kind: "network" });
  });

  it("paginates in pages of at most 200 until a short page, and honours a hard cap", async () => {
    const starts: number[] = [];
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ messageId: String(i) }));
    const c = client(async (url) => {
      const start = Number(url.searchParams.get("start"));
      starts.push(start);
      expect(Number(url.searchParams.get("limit"))).toBeLessThanOrEqual(200);
      return json({ data: start === 1 ? mk(200) : start === 201 ? mk(200) : mk(37) });
    });
    const sizes: number[] = [];
    for await (const page of c.searchAll("1", "fromDate:01-Nov-2026")) sizes.push(page.length);
    expect(sizes).toEqual([200, 200, 37]);
    expect(starts).toEqual([1, 201, 401]);

    const capped: number[] = [];
    // The provider honours `limit`, so the second request asks for only the 100 still needed.
    for await (const page of client(async (url) => json({ data: mk(Number(url.searchParams.get("limit"))) })).searchAll("1", "x", { maxMessages: 300 })) capped.push(page.length);
    expect(capped).toEqual([200, 100]);
  });
});

describe("address and content normalisation", () => {
  it("normalises addresses from every shape Zoho returns", () => {
    expect(normalizeAddress("  Geert@GeertKips.BE ")).toBe("geert@geertkips.be");
    expect(parseAddressList('"Geert Kips" &lt;Geert@geertkips.be&gt;, other@x.be;  geert@geertkips.be')).toEqual(["geert@geertkips.be", "other@x.be"]);
    expect(parseAddressList("Not Provided")).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
  });

  it("reduces HTML to plain text: scripts, styles, tags and tracking pixels vanish, nothing renders as markup", () => {
    const html = '<style>p{}</style><p>Hi <b>Ian</b></p><img src="https://track.example/pixel.gif" width=1><script>alert(1)</script><a href="https://evil.test">click</a>&lt;script&gt;alert(2)&lt;/script&gt; &amp; more';
    const text = htmlToSafeText(html);
    expect(text).toBe("Hi Ian click & more");
    expect(text).not.toMatch(/<|track\.example|alert|evil/);
    expect(htmlToSafeText("x".repeat(500), 100)).toHaveLength(100);
    expect(htmlToSafeText(null)).toBe("");
  });

  it("builds a mail record with direction from the mailbox, and skips unusable entries", () => {
    const incoming = toMailRecord({ messageId: 99, threadId: 7, folderId: 3, fromAddress: "geert@geertkips.be", toAddress: "hello@ianverlinden.com", ccAddress: "Not Provided", subject: " Re:  Website\n concept ", summary: "<p>ok</p>", sentDateInGMT: "1793460120000", receivedTime: "1793460130000" }, "hello@ianverlinden.com")!;
    expect(incoming).toMatchObject({ provider_message_id: "99", provider_thread_id: "7", direction: "incoming", from_address: "geert@geertkips.be", to_addresses: ["hello@ianverlinden.com"], cc_addresses: [], subject: "Re: Website concept", snippet: "ok" });
    expect(incoming.sent_at).toBe(new Date(1793460120000).toISOString());
    expect(toMailRecord({ messageId: 1, fromAddress: "Hello@IanVerlinden.com", toAddress: "a@b.be", receivedTime: 1793460130000 }, "hello@ianverlinden.com")?.direction).toBe("outgoing");
    expect(toMailRecord({ fromAddress: "a@b.be", receivedTime: 1 }, "me@x.be")).toBeNull();
    expect(toMailRecord({ messageId: 1, receivedTime: 5 }, "me@x.be")).toBeNull();
    expect(toMailRecord({ messageId: 1, fromAddress: "a@b.be" }, "me@x.be")).toBeNull();
  });
});

describe("prospect matching (exact normalised email only)", () => {
  const index = buildProspectIndex([
    { id: "geert", email: "Geert@GeertKips.be" },
    { id: "vault", email: "info@vaultone.be" },
    { id: "dup-a", email: "shared@example.be" },
    { id: "dup-b", email: "SHARED@example.be" },
    { id: "none", email: null },
  ]);
  const msg = (over: Partial<Parameters<typeof matchProspect>[0]>) => ({ direction: "incoming" as const, from_address: "x@y.be", to_addresses: [], cc_addresses: [], ...over });

  it("links an incoming message to its sender and an outgoing one to its recipient (to or cc)", () => {
    expect(matchProspect(msg({ from_address: "geert@geertkips.be" }), index, "hello@ianverlinden.com")).toBe("geert");
    expect(matchProspect(msg({ direction: "outgoing", from_address: "hello@ianverlinden.com", to_addresses: ["nobody@x.be"], cc_addresses: ["info@vaultone.be"] }), index, "hello@ianverlinden.com")).toBe("vault");
  });
  it("never fuzzy-matches: other addresses at the same domain, similar names and unknown senders do not match", () => {
    expect(matchProspect(msg({ from_address: "someone@geertkips.be" }), index, "hello@ianverlinden.com")).toBeNull();
    expect(matchProspect(msg({ from_address: "geert@geertkips.be.evil.com" }), index, "hello@ianverlinden.com")).toBeNull();
    expect(matchProspect(msg({ direction: "outgoing", to_addresses: ["geert@geertkips.bee"] }), index, "hello@ianverlinden.com")).toBeNull();
  });
  it("refuses to guess when two prospects share an address, and ignores your own mailbox", () => {
    expect(matchProspect(msg({ from_address: "shared@example.be" }), index, "hello@ianverlinden.com")).toBeNull();
    expect(matchProspect(msg({ direction: "outgoing", to_addresses: ["hello@ianverlinden.com"] }), buildProspectIndex([{ id: "me", email: "hello@ianverlinden.com" }]), "hello@ianverlinden.com")).toBeNull();
  });
});

describe("sync", () => {
  const prospects = [
    { id: "geert", email: "geert@geertkips.be" },
    { id: "vault", email: "info@vaultone.be" },
  ];
  const raw = (id: number, from: string, to: string, extra: Record<string, unknown> = {}) => ({ messageId: id, threadId: id, fromAddress: from, toAddress: to, subject: `S${id}`, summary: `snippet ${id}`, sentDateInGMT: String(1793460000000 + id * 1000), ...extra });
  const mailbox = "hello@ianverlinden.com";

  function fakeClient(pages: Array<Array<ReturnType<typeof raw>>>, behaviour?: { failFirstWithRateLimit?: boolean; failWith?: ZohoError }) {
    let calls = 0;
    return {
      searchAll: async function* () {
        calls++;
        if (behaviour?.failWith) throw behaviour.failWith;
        if (behaviour?.failFirstWithRateLimit && calls === 1) throw new ZohoError("slow down", "rate_limit", 429, 1);
        for (const page of pages) yield page;
      },
    } as unknown as ZohoMailClient;
  }
  function memoryStore(initial: string[] = []) {
    const stored = new Map<string, unknown>(initial.map((id) => [id, {}]));
    const store: MailStore = {
      async existingIds(ids) {
        return new Set(ids.filter((id) => stored.has(id)));
      },
      async save(records) {
        for (const r of records) stored.set(r.provider_message_id, r);
      },
    };
    return { store, stored };
  }
  const run = (client: ZohoMailClient, store: MailStore, over: Partial<Parameters<typeof runSync>[0]> = {}) =>
    runSync({ client, accountId: "1", mailbox, prospects, store, from: "2026-10-30", dryRun: false, sleep: async () => {}, ...over });

  const pages = [[raw(1, "geert@geertkips.be", mailbox), raw(2, mailbox, "info@vaultone.be"), raw(3, "newsletter@shop.be", mailbox), { messageId: 4 } as ReturnType<typeof raw>]];

  it("stores only mail that matches a prospect, counting what it checked and skipped", async () => {
    const { store, stored } = memoryStore();
    const report = await run(fakeClient(pages), store);
    expect(report).toMatchObject({ mode: "sync", checked: 4, skippedUnusable: 1, matched: 2, stored: 2, alreadyStored: 0, errors: [] });
    expect([...stored.keys()].sort()).toEqual(["1", "2"]);
    expect((stored.get("1") as { prospect_id: string; direction: string }).prospect_id).toBe("geert");
    expect((stored.get("2") as { direction: string }).direction).toBe("outgoing");
  });

  it("is idempotent: running it again duplicates nothing", async () => {
    const { store, stored } = memoryStore();
    await run(fakeClient(pages), store);
    const again = await run(fakeClient(pages), store);
    expect(again).toMatchObject({ matched: 2, alreadyStored: 2, stored: 0 });
    expect(stored.size).toBe(2);
  });

  it("dedupes a message that appears twice in one run (two pages)", async () => {
    const { store, stored } = memoryStore();
    const report = await run(fakeClient([[raw(1, "geert@geertkips.be", mailbox)], [raw(1, "geert@geertkips.be", mailbox)]]), store);
    expect(report.matched).toBe(1);
    expect(stored.size).toBe(1);
  });

  it("a dry run writes nothing but reports what it would do, with a small preview", async () => {
    const { store, stored } = memoryStore();
    const report = await run(fakeClient(pages), store, { dryRun: true });
    expect(report).toMatchObject({ mode: "dry_run", matched: 2, stored: 0 });
    expect(stored.size).toBe(0);
    expect(report.preview).toHaveLength(2);
    expect(report.preview[0]).toMatchObject({ prospect_id: "geert", direction: "incoming", subject: "S1" });
  });

  it("survives provider errors: partial results are kept and the error is reported, not thrown", async () => {
    const { store } = memoryStore();
    const report = await run(fakeClient(pages, { failWith: new ZohoError("Zoho Mail is unavailable (503).", "provider", 503) }), store);
    expect(report.errors).toEqual(["Zoho Mail is unavailable (503)."]);
    expect(report.stored).toBe(0);
  });

  it("waits and retries after a rate limit instead of failing", async () => {
    const { store, stored } = memoryStore();
    const sleep = vi.fn(async () => {});
    const report = await run(fakeClient(pages, { failFirstWithRateLimit: true }), store, { sleep });
    expect(sleep).toHaveBeenCalledWith(1);
    expect(report.errors).toEqual([]);
    expect(stored.size).toBe(2);
  });

  it("reports the full dry-run picture: unique, directions, unmatched, ambiguous, duplicate ids, folders and watched prospects", async () => {
    const { store } = memoryStore();
    const people = [...prospects, { id: "a", email: "shared@x.be" }, { id: "b", email: "SHARED@x.be" }];
    const page = [
      raw(1, "geert@geertkips.be", mailbox),
      raw(1, "geert@geertkips.be", mailbox), // the same provider id again
      raw(2, mailbox, "info@vaultone.be", { folderId: 11 }),
      raw(3, "stranger@elsewhere.be", mailbox),
      raw(4, "shared@x.be", mailbox),
      { messageId: 5 } as ReturnType<typeof raw>,
    ];
    const report = await run(fakeClient([page]), store, { dryRun: true, prospects: people, watch: new Set(["vault", "geert"]), folderNames: new Map([["11", "Sent"]]) });
    expect(report).toMatchObject({ checked: 6, unique: 4, duplicateIds: 1, incoming: 3, outgoing: 1, matched: 2, unmatched: 1, ambiguous: 1, skippedUnusable: 1, stored: 0 });
    expect(report.outgoingByFolder).toEqual({ Sent: 1 });
    expect(report.watched).toEqual([
      { prospect_id: "geert", outgoing: 0, incoming: 1, folders: ["unknown"] },
      { prospect_id: "vault", outgoing: 1, incoming: 0, folders: ["Sent"] },
    ].sort((x, y) => report.watched.findIndex((w) => w.prospect_id === x.prospect_id) - report.watched.findIndex((w) => w.prospect_id === y.prospect_id)));
  });

  it("uses Zoho's search date format and overlaps incremental runs by a day", () => {
    expect(zohoSearchDate("2026-11-01")).toBe("01-Nov-2026");
    expect(zohoSearchDate("2026-12-09")).toBe("09-Dec-2026");
    expect(incrementalStart("2026-11-05", "2026-10-22")).toBe("2026-11-04");
    expect(incrementalStart(null, "2026-10-22")).toBe("2026-10-22");
  });
});

describe("CRM timeline from synced mail (mail stays in its own table)", () => {
  const activity = (id: string, day: string, createdAt: string): ActivityRecord => ({ id, prospect_id: "p", type: "note", title: id, description: null, occurred_on: day, occurred_at: null, metadata: {}, created_at: createdAt });
  const mail = (id: string, direction: "incoming" | "outgoing", at: string): MailRow => ({ id, direction, from_address: "x@y.be", subject: `Subject ${id}`, snippet: null, sent_at: at });

  it("interleaves emails and activities, newest first, by Brussels day then time", () => {
    const items = mergeTimeline(
      [activity("view", "2026-11-01", "2026-11-01T05:46:00Z"), activity("created", "2026-10-30", "2026-10-30T10:00:00Z")],
      [mail("m1", "incoming", "2026-10-31T14:42:00Z"), mail("m0", "outgoing", "2026-10-30T10:12:00Z")],
    );
    expect(items.map((i) => i.key)).toEqual(["a:view", "m:m1", "m:m0", "a:created"]);
    // 23:30 UTC on 31 Oct is already 1 Nov in Brussels.
    expect(mergeTimeline([activity("a", "2026-11-01", "2026-11-01T00:00:00Z")], [mail("late", "incoming", "2026-10-31T23:30:00Z")]).map((i) => i.day)).toEqual(["2026-11-01", "2026-11-01"]);
  });

  it("suggests 'replied' only when the latest mail is incoming and the status hasn't moved on, never changing anything itself", () => {
    const reply = suggestReply("contacted", [mail("a", "outgoing", "2026-10-30T10:00:00Z"), mail("b", "incoming", "2026-10-31T10:00:00Z")]);
    expect(reply).toMatchObject({ suggestedStatus: "replied", currentLabel: "Contacted" });
    expect(reply?.mail.id).toBe("b");
    expect(suggestReply("contacted", [mail("a", "incoming", "2026-10-30T10:00:00Z"), mail("b", "outgoing", "2026-10-31T10:00:00Z")])).toBeNull();
    for (const status of ["replied", "interested", "won", "lost"] as const) expect(suggestReply(status, [mail("a", "incoming", "2026-10-31T10:00:00Z")])).toBeNull();
    expect(suggestReply("contacted", [])).toBeNull();
  });

  it("finds the last email", () => {
    expect(lastEmail([mail("a", "incoming", "2026-10-30T10:00:00Z"), mail("b", "outgoing", "2026-10-31T10:00:00Z")])?.id).toBe("b");
    expect(lastEmail([])).toBeNull();
  });
});
