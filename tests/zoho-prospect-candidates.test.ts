import { describe, expect, it } from "vitest";
import type { ZohoMailClient } from "@/lib/mail/zoho/client";
import { parseRecipientNames, type MailRecord } from "@/lib/mail/zoho/normalize";
import {
  candidateRecipients,
  isInternalAddress,
  isSystemOrTestAddress,
  mergeCandidate,
  relatedProspects,
  suggestName,
  type CandidateRow,
} from "@/lib/mail/zoho/prospect-candidates";
import { runSync, type MailStore } from "@/lib/mail/zoho/sync";
import { syncSummary } from "@/lib/mail/zoho/sync-summary";

/* No test below talks to Zoho or a database: the mailbox is a fake and the stores live in memory. */

const mailbox = "hello@ianverlinden.com";
const record = (over: Partial<MailRecord> = {}): MailRecord => ({
  provider_message_id: "m1",
  provider_thread_id: null,
  folder_id: null,
  direction: "outgoing",
  from_address: mailbox,
  to_addresses: ["info@nieuwbedrijf.be"],
  cc_addresses: [],
  subject: "Idee voor jullie website",
  snippet: null,
  sent_at: "2026-11-02T09:00:00.000Z",
  ...over,
});

describe("which unmatched mail is worth a review", () => {
  it("proposes an outgoing message to an external recipient", () => {
    expect(candidateRecipients(record(), mailbox, new Map([["info@nieuwbedrijf.be", "Nieuw Bedrijf"]]))).toEqual({ recipients: [{ address: "info@nieuwbedrijf.be", displayName: "Nieuw Bedrijf" }], reason: null });
  });

  it("never proposes incoming mail, however unknown the sender", () => {
    expect(candidateRecipients(record({ direction: "incoming", from_address: "spam@promo.be", to_addresses: [mailbox] }), mailbox).recipients).toEqual([]);
  });

  it("skips your own address, your own domain (colleagues, aliases, the contact form) and anything sent only to yourself", () => {
    expect(isInternalAddress(mailbox, mailbox)).toBe(true);
    expect(isInternalAddress("contact@ianverlinden.com", mailbox)).toBe(true);
    expect(isInternalAddress("klant@bedrijf.be", mailbox)).toBe(false);
    expect(candidateRecipients(record({ to_addresses: [mailbox] }), mailbox).recipients).toEqual([]);
    expect(candidateRecipients(record({ to_addresses: ["other@ianverlinden.com", "klant@bedrijf.be"] }), mailbox).recipients.map((r) => r.address)).toEqual(["klant@bedrijf.be"]);
  });

  it("does not treat a shared mail provider as 'your own domain'", () => {
    expect(isInternalAddress("someone@gmail.com", "me@gmail.com")).toBe(false);
    expect(isInternalAddress("me@gmail.com", "me@gmail.com")).toBe(true);
  });

  it("skips test messages and system or reserved addresses", () => {
    expect(candidateRecipients(record({ subject: "Test" }), mailbox).reason).toBe("test message");
    expect(candidateRecipients(record({ subject: "Re: testmail 2" }), mailbox).reason).toBe("test message");
    expect(candidateRecipients(record({ subject: "Testimonial voor jullie" }), mailbox).recipients).toHaveLength(1);
    for (const a of ["noreply@shop.be", "no-reply@shop.be", "mailer-daemon@x.be", "test@gmail.com", "test1@bedrijf.be", "anyone@example.com", "a@b.test", "a@b.invalid"]) {
      expect(isSystemOrTestAddress(a), a).toBe(true);
    }
    for (const a of ["tester@bedrijf.be", "info@bedrijf.be", "contact@testbedrijf.be"]) expect(isSystemOrTestAddress(a), a).toBe(false);
  });

  it("looks only at To (a Cc is a bystander) and ignores mailings to many people", () => {
    expect(candidateRecipients(record({ to_addresses: [mailbox], cc_addresses: ["klant@bedrijf.be"] }), mailbox).recipients).toEqual([]);
    const many = Array.from({ length: 6 }, (_, i) => `p${i}@bedrijf${i}.be`);
    expect(candidateRecipients(record({ to_addresses: many }), mailbox)).toMatchObject({ recipients: [], reason: "sent to many recipients" });
  });
});

describe("what is suggested, and only where the evidence supports it", () => {
  it("reads a display name from the header and nothing else", () => {
    const names = parseRecipientNames('&quot;Garage Heyrick&quot; &lt;info@garage-heyrick.be&gt;, Ann <ann@x.be>, plain@y.be, "plain2@y.be" <plain2@y.be>');
    expect(names.get("info@garage-heyrick.be")).toBe("Garage Heyrick");
    expect(names.get("ann@x.be")).toBe("Ann");
    expect(names.has("plain@y.be")).toBe(false);
    expect(names.has("plain2@y.be")).toBe(false);
  });

  it("uses the display name, else a distinctive domain, else the address itself (never invents a person or a city)", () => {
    expect(suggestName("info@x.be", "Garage Heyrick")).toEqual({ value: "Garage Heyrick", basis: "header" });
    expect(suggestName("info@garage-heyrick.be", null)).toEqual({ value: "Garage Heyrick", basis: "domain" });
    expect(suggestName("jan@gmail.com", null)).toEqual({ value: "jan@gmail.com", basis: "address" });
    expect(suggestName("a@ab.be", null)).toEqual({ value: "a@ab.be", basis: "address" });
  });

  it("shows which existing prospects already use this address, domain or website, without hiding the candidate", () => {
    const prospects = [
      { id: "1", company_name: "Acme", email: "info@acme.be", website_url: null },
      { id: "2", company_name: "Acme Garage", email: null, website_url: "https://www.acme.be" },
      { id: "3", company_name: "Gmail friend", email: "x@gmail.com", website_url: null },
    ];
    expect(relatedProspects("sales@acme.be", prospects).map((r) => [r.id, r.reason])).toEqual([["1", "same email domain"], ["2", "website matches"]]);
    expect(relatedProspects("info@acme.be", prospects)[0]).toMatchObject({ id: "1", reason: "same email address" });
    expect(relatedProspects("y@gmail.com", prospects)).toEqual([]);
  });
});

describe("merging a candidate", () => {
  const draft = (ids: string[]) => ({ address: "info@nieuwbedrijf.be", displayName: "Nieuw", messages: ids.map((id, i) => record({ provider_message_id: id, sent_at: `2026-11-0${i + 1}T09:00:00.000Z` })) });
  const stored = (over: Partial<CandidateRow> = {}): CandidateRow => ({ address: "info@nieuwbedrijf.be", display_name: "Nieuw", status: "pending", subject: "S", first_message_at: "2026-11-01T09:00:00.000Z", last_message_at: "2026-11-01T09:00:00.000Z", message_count: 1, messages: [record({ provider_message_id: "a", sent_at: "2026-11-01T09:00:00.000Z" })], ...over });

  it("creates a pending row from the messages seen, oldest and newest kept", () => {
    const merged = mergeCandidate(null, draft(["a", "b"]))!;
    expect(merged.created).toBe(true);
    expect(merged.row).toMatchObject({ status: "pending", message_count: 2, first_message_at: "2026-11-01T09:00:00.000Z", last_message_at: "2026-11-02T09:00:00.000Z" });
  });

  it("a repeated sync changes nothing; a new message to the same address is added once", () => {
    expect(mergeCandidate(stored(), draft(["a"]))).toBeNull();
    const next = mergeCandidate(stored(), draft(["a", "b"]))!;
    expect(next.created).toBe(false);
    expect(next.row.message_count).toBe(2);
    expect(next.row.messages.map((m) => m.provider_message_id).sort()).toEqual(["a", "b"]);
  });

  it("an ignored or added address is never proposed again", () => {
    expect(mergeCandidate(stored({ status: "ignored", messages: [] }), draft(["z"]))).toBeNull();
    expect(mergeCandidate(stored({ status: "added", messages: [] }), draft(["z"]))).toBeNull();
  });
});

describe("a sync proposes candidates and never creates a prospect", () => {
  const raw = (id: number, from: string, to: string, extra: Record<string, unknown> = {}) => ({ messageId: id, threadId: id, fromAddress: from, toAddress: to, subject: `S${id}`, summary: "text", sentDateInGMT: String(1793460000000 + id * 1000), ...extra });
  const prospects = [{ id: "geert", email: "geert@geertkips.be" }];

  const fakeClient = (page: Array<ReturnType<typeof raw>>) => ({ searchAll: async function* () { yield page; } }) as unknown as ZohoMailClient;

  function memory() {
    const mail = new Map<string, unknown>();
    const candidates = new Map<string, CandidateRow>();
    const store: MailStore = {
      async existingIds(ids) {
        return new Set(ids.filter((id) => mail.has(id)));
      },
      async save(records) {
        for (const r of records) mail.set(r.provider_message_id, r);
      },
      async candidateRows(addresses) {
        return new Map(addresses.flatMap((a) => (candidates.has(a) ? [[a, candidates.get(a)!] as const] : [])));
      },
      async saveCandidates(rows) {
        for (const r of rows) candidates.set(r.address, r);
      },
    };
    return { store, mail, candidates };
  }
  const run = (page: Array<ReturnType<typeof raw>>, store: MailStore, dryRun = false) =>
    runSync({ client: fakeClient(page), accountId: "1", mailbox, prospects, store, from: "2026-10-30", dryRun, sleep: async () => {} });

  it("outgoing mail to an existing prospect matches it and creates no candidate", async () => {
    const { store, mail, candidates } = memory();
    const report = await run([raw(1, mailbox, "geert@geertkips.be")], store);
    expect(report).toMatchObject({ matched: 1, matchedProspects: 1, stored: 1, candidates: 0, unmatched: 0 });
    expect(mail.size).toBe(1);
    expect(candidates.size).toBe(0);
  });

  it("outgoing mail to an unknown external address becomes a candidate: not stored, not a prospect, and said so", async () => {
    const { store, mail, candidates } = memory();
    const report = await run([raw(2, mailbox, '"Nieuw Bedrijf" <info@nieuwbedrijf.be>')], store);
    expect(report).toMatchObject({ matched: 0, stored: 0, unmatched: 1, candidates: 1, errors: [] });
    expect(report.candidatePreview).toEqual([{ address: "info@nieuwbedrijf.be", subject: "S2", sent_at: expect.any(String) }]);
    expect(mail.size).toBe(0);
    expect([...candidates.values()]).toMatchObject([{ address: "info@nieuwbedrijf.be", display_name: "Nieuw Bedrijf", status: "pending", message_count: 1 }]);
    expect(syncSummary({ ...report, candidatesPending: 1 })).toEqual({ title: "Sync complete", parts: ["0 new emails", "1 new prospect candidate", "0 errors"], pending: 1 });
  });

  it("internal, test, self-addressed and incoming mail never produce a candidate (and no prospect)", async () => {
    const { store, candidates } = memory();
    const report = await run(
      [
        raw(3, mailbox, "colleague@ianverlinden.com"),
        raw(4, mailbox, "someone@bedrijf.be", { subject: "Test" }),
        raw(5, "contact@ianverlinden.com", mailbox),
        raw(6, mailbox, mailbox),
        raw(7, "unknown@supplier.be", mailbox),
        raw(8, "newsletter@shop.be", mailbox),
        raw(9, mailbox, "noreply@shop.be"),
      ],
      store,
    );
    expect(report).toMatchObject({ unmatched: 7, candidates: 0, matched: 0, stored: 0, errors: [] });
    expect(candidates.size).toBe(0);
  });

  it("a dry run counts and lists the candidates but stores nothing", async () => {
    const { store, candidates } = memory();
    const report = await run([raw(2, mailbox, "info@nieuwbedrijf.be")], store, true);
    expect(report).toMatchObject({ mode: "dry_run", candidates: 1 });
    expect(candidates.size).toBe(0);
  });

  it("repeating the sync neither duplicates the candidate nor reports it as new again", async () => {
    const { store, candidates } = memory();
    const page = [raw(2, mailbox, "info@nieuwbedrijf.be")];
    await run(page, store);
    const again = await run(page, store);
    expect(again).toMatchObject({ candidates: 0, candidatesKnown: 1 });
    expect(candidates.size).toBe(1);
    expect([...candidates.values()][0].message_count).toBe(1);
  });

  it("an ignored address does not come back, even when you write to it again", async () => {
    const { store, candidates } = memory();
    await run([raw(2, mailbox, "info@nieuwbedrijf.be")], store);
    const row = candidates.get("info@nieuwbedrijf.be")!;
    candidates.set(row.address, { ...row, status: "ignored", messages: [] });
    const again = await run([raw(2, mailbox, "info@nieuwbedrijf.be"), raw(10, mailbox, "info@nieuwbedrijf.be")], store);
    expect(again).toMatchObject({ candidates: 0, errors: [] });
    expect(candidates.get("info@nieuwbedrijf.be")).toMatchObject({ status: "ignored", messages: [] });
  });

  it("a sync without a candidate store behaves exactly as before", async () => {
    const mail = new Map<string, unknown>();
    const store: MailStore = { existingIds: async (ids) => new Set(ids.filter((id) => mail.has(id))), save: async (r) => void r.forEach((x) => mail.set(x.provider_message_id, x)) };
    const report = await run([raw(1, mailbox, "geert@geertkips.be"), raw(2, mailbox, "info@nieuwbedrijf.be")], store);
    expect(report).toMatchObject({ matched: 1, unmatched: 1, candidates: 0, stored: 1 });
  });
});
