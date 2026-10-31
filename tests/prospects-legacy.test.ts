import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGeertLinkSql, buildImportSql, findSourceDuplicates, lit, mapLegacyRow, parseAmount, parseDutchDay } from "../scripts/prospects-legacy/legacy-map.mjs";

type Raw = Record<string, string | number | null>;

/** Synthetic rows shaped like the legacy tracker (no real contacts in the repository). */
const row = (over: Raw = {}): Raw => ({
  legacyId: 1, company: "Voorbeeld Garage", sector: "Automotive", city: "Oostende", website: null, email: "info@voorbeeld.example",
  contact: null, status: "Gecontacteerd", priority: "Normaal", firstContact: "29 okt 2026", lastContact: "29 okt 2026",
  nextFollowUp: "05 nov 2026", deliveryConfirmed: "Ja", estimatedValue: null, quote: null,
  notes: "Gebruiker bevestigde contact.", lastAction: "Eerste contact", ...over,
});

describe("legacy tracker mapping", () => {
  it("maps statuses, priorities and delivery exactly as the brief says", () => {
    const a = mapLegacyRow(row());
    expect(a).toMatchObject({ legacyRef: "website-prospect-crm:1", status: "contacted", priority: "normal", contact_delivery_status: "confirmed" });
    expect(mapLegacyRow(row({ status: "Reactie ontvangen" })).status).toBe("replied");
    expect(mapLegacyRow(row({ deliveryConfirmed: "Controleer" })).contact_delivery_status).toBe("needs_verification");
    expect(mapLegacyRow(row({ deliveryConfirmed: null })).contact_delivery_status).toBe("unknown");
  });

  it("never infers stronger statuses and refuses vocabulary it doesn't know", () => {
    expect(() => mapLegacyRow(row({ status: "Geïnteresseerd" }))).toThrow(/no mapping/);
    expect(() => mapLegacyRow(row({ priority: "Superbelangrijk" }))).toThrow(/no mapping/);
    expect(() => mapLegacyRow(row({ deliveryConfirmed: "Misschien" }))).toThrow(/no mapping/);
    expect(() => mapLegacyRow(row({ company: " " }))).toThrow(/company is missing/);
  });

  it("keeps blanks blank and preserves notes verbatim (the 'verify' wording is never rewritten)", () => {
    const verify = "Getoond in Zoho Drafts; verifieer of bericht in Verzonden staat.";
    const m = mapLegacyRow(row({ email: null, city: null, notes: verify, deliveryConfirmed: "Controleer" }));
    expect(m).toMatchObject({ email: null, city: null, website_url: null, contact_name: null, estimated_value_eur: null, quote_value_eur: null, notes: verify });
    expect(m.notes).not.toMatch(/bevestigd|confirmed/i);
    expect(m.warnings.join(" ")).toMatch(/no email/);
    expect(m.warnings.join(" ")).toMatch(/Controleer/);
  });

  it("preserves the follow-up dates exactly (never recalculated against today)", () => {
    expect(parseDutchDay("29 okt 2026")).toBe("2026-10-29");
    expect(parseDutchDay("05 nov 2026")).toBe("2026-11-05");
    expect(parseDutchDay("07 nov 2026")).toBe("2026-11-07");
    expect(parseDutchDay(null)).toBeNull();
    expect(() => parseDutchDay("31 feb 2026")).toThrow();
    expect(() => parseDutchDay("someday")).toThrow();
    const m = mapLegacyRow(row({ firstContact: "30 okt 2026", lastContact: "31 okt 2026", nextFollowUp: "06 nov 2026" }));
    expect([m.first_contact_on, m.last_contact_on, m.next_follow_up_on]).toEqual(["2026-10-30", "2026-10-31", "2026-11-06"]);
  });

  it("does not store the derived 'days until follow-up'", () => {
    expect(Object.keys(mapLegacyRow({ ...row(), daysUntil: 5 }))).not.toContain("daysUntil");
  });

  it("parses amounts without turning blanks into zero", () => {
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("€ 1.500,50")).toBe(1500.5);
    expect(() => parseAmount("abc")).toThrow();
  });

  it("finds real duplicates inside the source", () => {
    const a = mapLegacyRow(row({ legacyId: 1 }));
    const b = mapLegacyRow(row({ legacyId: 2, company: "voorbeeld  GARAGE!", email: "ander@x.example" }));
    const c = mapLegacyRow(row({ legacyId: 3, company: "Anders", email: "INFO@voorbeeld.example" }));
    expect(findSourceDuplicates([a, b, c])).toEqual([{ row: 2, of: 1, kind: "company" }, { row: 3, of: 1, kind: "email" }]);
    expect(findSourceDuplicates([a, mapLegacyRow(row({ legacyId: 4, company: "Anders", email: "z@z.example" }))])).toEqual([]);
  });
});

describe("generated SQL", () => {
  const mapped = [mapLegacyRow(row()), mapLegacyRow(row({ legacyId: 2, company: "Tuin d'Hooghe", email: null, notes: "It's \"quoted\"; back\\slash" }))];
  const sql = buildImportSql(mapped, { parsed: 2, sourceDuplicates: 0, warnings: ["w1"] });

  it("is a single idempotent statement keyed by legacy_ref", () => {
    expect(sql).toMatch(/on conflict \(legacy_ref\) do nothing/);
    expect(sql.match(/insert into public\.prospects /g)).toHaveLength(1);
    expect(sql.match(/;\s*$/g)).toHaveLength(1);
    expect(sql).toMatch(/'website-prospect-crm:1'/);
    expect(sql).toMatch(/'website-prospect-crm:2'/);
  });

  it("quotes values safely", () => {
    expect(lit("Tuin d'Hooghe")).toBe("'Tuin d''Hooghe'");
    expect(lit(null)).toBe("null");
    expect(() => lit("a\0b")).toThrow();
    expect(sql).toContain("'Tuin d''Hooghe'");
    expect(sql).toContain("'It''s \"quoted\"; back\\slash'");
  });

  it("writes the audit record and adds no activity for rows without a last action", () => {
    expect(sql).toMatch(/insert into public\.prospect_imports/);
    expect(sql).toMatch(/'legacy PDF migration'/);
    expect(sql).toMatch(/where src\.last_action is not null/);
  });

  it("links Geert only when exactly one prospect and one preview match, and never edits the preview", () => {
    const link = buildGeertLinkSql();
    expect(link).toMatch(/\(select count\(\*\) from prospect\) = 1 and \(select count\(\*\) from preview\) = 1/);
    expect(link).toMatch(/subdomain = 'geertkips'/);
    expect(link).not.toMatch(/update public\.client_previews|delete from public\.client_previews|access_code/i);
  });
});

/** Runs only on the machine that holds the parsed PDF (the data file is git-ignored). */
const dataFile = "scripts/prospects-legacy/data/prospects-legacy.json";
describe.skipIf(!existsSync(dataFile))("the real legacy PDF (local data only)", () => {
  const source = existsSync(dataFile) ? (JSON.parse(readFileSync(dataFile, "utf8")) as Raw[]) : [];
  const mapped = source.map(mapLegacyRow) as unknown as Array<Record<string, string | number | null>>;

  it("parses 35 prospects with the expected companies and no duplicates", () => {
    expect(source).toHaveLength(35);
    expect(mapped).toHaveLength(35);
    expect(findSourceDuplicates(mapped)).toEqual([]);
    const names = mapped.map((m) => m.company_name);
    for (const expected of ["Auto's Nollet", "Steershop", "Depannage SOS", "SBP reCYCLING", "De Companie", "Fietsatelier Deroo", "Garage Heyrick", "Tuinen Ward", "Fietsen Vanneste", "Feestzaal PUUR", "Schoonheidssalon Ann Van Hende", "Kattendroom", "Dierenpension 't Haegeland", "Geo-Technics", "Cardon's Car Detailing", "Rijschool Vision", "SMSK Car Detailing", "Elektro Nico", "De Open Ruimte", "Alpha Hotel", "DRC Elektro", "Kapsalin", "Tuinaanleg Pijkhof", "Garage Verheyen", "De Dakdekker", "Recour", "TC Dakwerken", "Artifex", "Schrijnwerkerij Van Olmen", "Geert Kips", "Dakfolietools", "Verniers", "Schrijnwerk De Laet", "Schrijnwerk Beerlandt", "Vault One"]) {
      expect(names, expected).toContain(expected);
    }
  });

  it("keeps Geert Kips exactly as in the tracker", () => {
    const geert = mapped.find((m) => m.company_name === "Geert Kips")!;
    expect(geert).toMatchObject({ status: "replied", email: "geert@geertkips.be", first_contact_on: "2026-10-30", last_contact_on: "2026-10-31", next_follow_up_on: "2026-11-06", priority: "normal", contact_delivery_status: "confirmed" });
    expect(geert.notes).toBe("Getoond in Zoho Drafts; verifieer of bericht in Verzonden staat.");
  });

  it("preserves the delivery flags, follow-ups, notes and emails as a whole", () => {
    const count = (key: string) => mapped.filter((m) => m[key] !== null).length;
    expect(mapped.filter((m) => m.contact_delivery_status === "needs_verification")).toHaveLength(24);
    expect(mapped.filter((m) => m.contact_delivery_status === "confirmed")).toHaveLength(10);
    expect(mapped.filter((m) => m.contact_delivery_status === "unknown")).toHaveLength(1);
    expect(mapped.filter((m) => m.status === "replied")).toHaveLength(1);
    expect(count("next_follow_up_on")).toBe(35);
    expect(count("email")).toBe(26);
    expect(count("notes")).toBe(34);
    expect(new Set(mapped.map((m) => m.next_follow_up_on))).toEqual(new Set(["2026-11-05", "2026-11-06", "2026-11-07"]));
  });
});
