import { describe, expect, it } from "vitest";
import { CsvError, csvCell, detectDelimiter, neutralizeFormula, parseCsv, toCsv } from "@/lib/prospects/csv";
import { findBatchDuplicates, findDuplicates, normalizeCompany, normalizeEmail, websiteHost } from "@/lib/prospects/duplicates";
import { autoMapColumns, buildCandidate, parseDelivery, parsePriority, parseStatus } from "@/lib/prospects/import";

describe("CSV reading", () => {
  it("parses quoted fields, doubled quotes and embedded newlines", () => {
    const rows = parseCsv('Bedrijf,Notities\r\n"Acme, BV","Zei ""ja""\nen belde terug"\r\nZonder,\r\n');
    expect(rows).toEqual([["Bedrijf", "Notities"], ["Acme, BV", 'Zei "ja"\nen belde terug'], ["Zonder", ""]]);
  });

  it("detects the semicolon delimiter Belgian Excel writes, and tabs", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter('"a,b";c')).toBe(";");
    expect(parseCsv("Bedrijf;Stad\nAcme;Brugge")).toEqual([["Bedrijf", "Stad"], ["Acme", "Brugge"]]);
  });

  it("strips a BOM, skips blank lines and rejects an unclosed quote", () => {
    expect(parseCsv("﻿a,b\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(() => parseCsv('a,"b')).toThrow(CsvError);
  });
});

describe("CSV safety (formula injection)", () => {
  it("neutralises cells a spreadsheet would execute", () => {
    for (const evil of ["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "\t=1", "\r=1"]) expect(neutralizeFormula(evil), evil).toBe(`'${evil}`);
    expect(neutralizeFormula("Normal Company")).toBe("Normal Company");
    expect(neutralizeFormula("a=b")).toBe("a=b");
  });

  it("applies it in the generated file, quoting separators, and keeps numbers numeric", () => {
    const csv = toCsv([["Company", "Notes", "Value"], ["=HYPERLINK(\"http://x\")", "line1\nline2, with comma", 1500.5], [null, undefined, -2]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csv).toContain('"line1\nline2, with comma"');
    expect(csv).toContain(",1500.5\r\n");
    expect(csv).toContain(",,-2\r\n"); // a real number is not a formula
    expect(csvCell("-5")).toBe("'-5"); // but the text "-5" is
  });

  it("round-trips through parseCsv", () => {
    const rows = [["Bedrijf", "Notities"], ["Acme", "a, b"], ["X \"Y\"", "line\nbreak"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("column mapping", () => {
  it("recognises Dutch headers from the legacy tracker", () => {
    const m = autoMapColumns(["ID", "Bedrijf", "Sector", "Stad", "Website", "E-mailadres", "Contactpersoon", "Status", "Prioriteit", "Eerste contact", "Laatste contact", "Volgende opvolging", "Verzending bevestigd?", "Geschatte waarde (€)", "Offerte (€)", "Notities", "Laatste actie"]);
    expect(m).toMatchObject({ companyName: 1, sector: 2, city: 3, websiteUrl: 4, email: 5, contactName: 6, status: 7, priority: 8, firstContactOn: 9, lastContactOn: 10, nextFollowUpOn: 11, deliveryStatus: 12, estimatedValue: 13, quoteValue: 14, notes: 15, lastAction: 16 });
  });
  it("recognises the headers of the CRM's own export, and leaves unknown columns unmapped", () => {
    const m = autoMapColumns(["Company", "Email", "Status", "Mystery", "Estimated value (EUR)", "Next follow-up"]);
    expect(m).toMatchObject({ companyName: 0, email: 1, status: 2, estimatedValue: 4, nextFollowUpOn: 5, sector: null });
  });
});

describe("vocabulary", () => {
  it("maps Dutch and English statuses/priorities, and refuses to guess", () => {
    expect(parseStatus("Gecontacteerd")).toBe("contacted");
    expect(parseStatus("Reactie ontvangen")).toBe("replied");
    expect(parseStatus("Quote sent")).toBe("quote_sent");
    expect(parseStatus("follow_up_due")).toBe("follow_up_due");
    expect(parseStatus("Offerte verstuurd")).toBe("quote_sent");
    expect(parseStatus("maybe")).toBeNull();
    expect(parsePriority("Normaal")).toBe("normal");
    expect(parsePriority("URGENT")).toBe("urgent");
    expect(parsePriority("meh")).toBeNull();
  });
  it("keeps the delivery flag: Ja / Controleer / blank", () => {
    expect(parseDelivery("Ja")).toBe("confirmed");
    expect(parseDelivery("Controleer")).toBe("needs_verification");
    expect(parseDelivery("")).toBe("unknown");
    expect(parseDelivery("???")).toBeNull();
  });
});

describe("row validation", () => {
  const headers = ["Bedrijf", "Sector", "E-mailadres", "Status", "Prioriteit", "Eerste contact", "Volgende opvolging", "Geschatte waarde (€)", "Verzending bevestigd?"];
  const mapping = autoMapColumns(headers);

  it("builds a valid candidate and preserves the dates exactly as given", () => {
    const c = buildCandidate(["Geert Kips", "Bouw", "geert@geertkips.be", "Reactie ontvangen", "Normaal", "30 okt 2026", "06 nov 2026", "", "Controleer"], mapping, 2);
    expect(c.errors).toEqual([]);
    expect(c.input).toMatchObject({ companyName: "Geert Kips", status: "replied", priority: "normal", firstContactOn: "2026-10-30", nextFollowUpOn: "2026-11-06", estimatedValue: null, deliveryStatus: "needs_verification" });
  });

  it("reports every problem instead of guessing", () => {
    const c = buildCandidate(["", "Bouw", "not-an-email", "Maybe", "Normaal", "32/13/2026", "", "abc", ""], mapping, 7);
    expect(c.input).toBeNull();
    expect(c.row).toBe(7);
    expect(c.errors.join(" | ")).toMatch(/Unknown status "Maybe"/);
    expect(c.errors.join(" | ")).toMatch(/Invalid first contact date/);
    expect(c.errors.join(" | ")).toMatch(/Invalid estimated value/);
    expect(c.errors.join(" | ")).toMatch(/Company name is missing/);
    expect(c.errors.join(" | ")).toMatch(/valid email/);
  });

  it("leaves blank cells blank (no invented defaults beyond new/normal)", () => {
    const c = buildCandidate(["Only Name", "", "", "", "", "", "", "", ""], mapping, 2);
    expect(c.input).toMatchObject({ companyName: "Only Name", sector: null, email: null, firstContactOn: null, estimatedValue: null, status: "new", priority: "normal", deliveryStatus: "unknown" });
  });
});

describe("duplicate detection", () => {
  it("normalises company names, emails and website hosts", () => {
    expect(normalizeCompany("Garage  Heyrick BVBA")).toBe(normalizeCompany("garage heyrick"));
    expect(normalizeCompany("Café Zoë & Co")).toBe(normalizeCompany("cafe zoe en co"));
    expect(normalizeEmail("  Info@Example.BE ")).toBe("info@example.be");
    expect(websiteHost("https://www.Vaultone.be/contact")).toBe("vaultone.be");
    expect(websiteHost("vaultone.be")).toBe("vaultone.be");
    expect(websiteHost("not a url")).toBe("");
  });

  it("finds likely duplicates by company, email or website, with the reasons", () => {
    const existing = [
      { id: "1", company_name: "Geert Kips", email: "geert@geertkips.be", website_url: null },
      { id: "2", company_name: "Vault One", email: null, website_url: "https://www.vaultone.be/" },
      { id: "3", company_name: "Other", email: "x@y.be", website_url: null },
    ];
    expect(findDuplicates({ company_name: "GEERT KIPS", email: null, website_url: null }, existing)).toEqual([{ match: existing[0], reasons: ["company"] }]);
    expect(findDuplicates({ company_name: "New name", email: "Geert@GeertKips.be", website_url: null }, existing)[0].reasons).toEqual(["email"]);
    expect(findDuplicates({ company_name: "Vault 1", email: null, website_url: "vaultone.be" }, existing)[0].reasons).toEqual(["website"]);
    expect(findDuplicates({ company_name: "Brand new", email: "new@new.be", website_url: "https://new.be" }, existing)).toEqual([]);
  });

  it("finds duplicates inside the same file, pointing at the first occurrence", () => {
    const rows = [
      { company_name: "Acme", email: "a@acme.be", website_url: null },
      { company_name: "Beta", email: null, website_url: null },
      { company_name: "ACME BV", email: "other@acme.be", website_url: null },
      { company_name: "Gamma", email: "A@acme.be", website_url: null },
    ];
    const dupes = findBatchDuplicates(rows);
    expect(dupes.get(2)).toEqual({ of: 0, reasons: ["company"] });
    expect(dupes.get(3)).toEqual({ of: 0, reasons: ["email"] });
    expect(dupes.has(1)).toBe(false);
    expect(dupes.has(0)).toBe(false);
  });
});
