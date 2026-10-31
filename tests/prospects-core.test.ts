import { describe, expect, it } from "vitest";
import { classifyFollowUp, addDays, brusselsToday, diffDays, endOfWeek, followUpLabel, formatDay, isIsoDay, parseFlexibleDay } from "@/lib/prospects/dates";
import { formatEur, parseMoney } from "@/lib/prospects/money";
import { CLOSED_STATUSES, OPPORTUNITY_STATUSES, PROSPECT_STATUSES, REPLIED_STATUSES, STATUS_LABELS } from "@/lib/prospects/constants";
import { emptyProspectForm, normalizeWebsite, prospectToFormValues, toProspectRow, validateProspectForm } from "@/lib/schemas/prospect";
import { snapshotEqual } from "@/lib/dirty";

describe("calendar days (Europe/Brussels)", () => {
  it("knows today in Brussels, not on the server clock", () => {
    // 23:30 UTC on 30 Oct is already 00:30 on 31 Oct in Brussels (CET after the clocks change).
    expect(brusselsToday(new Date("2026-10-30T23:30:00Z"))).toBe("2026-10-31");
    expect(brusselsToday(new Date("2026-10-31T12:00:00Z"))).toBe("2026-10-31");
    // Summer time: 22:30 UTC is 00:30 the next day.
    expect(brusselsToday(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
  });

  it("does day arithmetic without drifting across daylight-saving changes", () => {
    expect(addDays("2026-10-24", 3)).toBe("2026-10-27");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(diffDays("2026-11-02", "2026-10-24")).toBe(9);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("ends the week on Sunday", () => {
    expect(endOfWeek("2026-10-31")).toBe("2026-11-01"); // Saturday
    expect(endOfWeek("2026-11-01")).toBe("2026-11-01"); // Sunday
    expect(endOfWeek("2026-11-02")).toBe("2026-11-08"); // Monday
  });

  it("validates real calendar days only", () => {
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("2028-02-29")).toBe(true);
    expect(isIsoDay("2026-13-01")).toBe(false);
    expect(isIsoDay("29/10/2026")).toBe(false);
  });
});

describe("follow-up classification", () => {
  const today = "2026-11-02";
  it("is overdue before today, due today, tomorrow, then upcoming", () => {
    expect(classifyFollowUp("2026-10-31", today)).toEqual({ kind: "overdue", days: 2 });
    expect(classifyFollowUp("2026-11-01", today)).toEqual({ kind: "overdue", days: 1 });
    expect(classifyFollowUp("2026-11-02", today)).toEqual({ kind: "today" });
    expect(classifyFollowUp("2026-11-03", today)).toEqual({ kind: "tomorrow" });
    expect(classifyFollowUp("2026-11-09", today)).toEqual({ kind: "upcoming", days: 7 });
    expect(classifyFollowUp(null, today)).toEqual({ kind: "none" });
  });

  it("describes them for people", () => {
    expect(followUpLabel({ kind: "overdue", days: 2 })).toBe("Overdue 2 days");
    expect(followUpLabel({ kind: "overdue", days: 1 })).toBe("Overdue 1 day");
    expect(followUpLabel({ kind: "today" })).toBe("Due today");
  });

  it("never rewrites imported follow-up dates relative to today", () => {
    // Classification is a pure view of (date, today): the stored date does not change when today does.
    const stored = "2026-11-05";
    expect(classifyFollowUp(stored, "2026-10-31").kind).toBe("upcoming");
    expect(classifyFollowUp(stored, "2026-11-20")).toEqual({ kind: "overdue", days: 15 });
    expect(stored).toBe("2026-11-05");
  });
});

describe("date parsing", () => {
  it("reads Dutch, English, ISO and Belgian numeric dates", () => {
    for (const [input, expected] of [
      ["29 okt 2026", "2026-10-29"],
      ["05 nov 2026", "2026-11-05"],
      ["29 Oct 2026", "2026-10-29"],
      ["29/10/2026", "2026-10-29"],
      ["29-10-2026", "2026-10-29"],
      ["29.10.2026", "2026-10-29"],
      ["2026-10-29", "2026-10-29"],
      ["2026-10-29T08:00:00Z", "2026-10-29"],
      ["3 mrt 2027", "2027-03-03"],
    ] as const) expect(parseFlexibleDay(input), input).toBe(expected);
    expect(parseFlexibleDay(new Date(Date.UTC(2026, 9, 29)))).toBe("2026-10-29");
  });

  it("rejects anything that is not a real day", () => {
    for (const bad of ["", "31 feb 2026", "99/99/2026", "soon", "29 xyz 2026", null, 5]) expect(parseFlexibleDay(bad), String(bad)).toBeNull();
  });

  it("formats a day without a time-zone shift", () => {
    expect(formatDay("2026-10-29")).toBe("29 Oct 2026");
    expect(formatDay(null)).toBe("—");
  });
});

describe("money", () => {
  it("parses the ways people write euros", () => {
    for (const [input, expected] of [
      ["1500", 1500],
      ["€ 1.500,50", 1500.5],
      ["1,500.50", 1500.5],
      ["1.500", 1500],
      ["1,5", 1.5],
      ["2500 EUR", 2500],
      [1250.456, 1250.46],
    ] as const) expect(parseMoney(input), String(input)).toBe(expected);
  });

  it("treats blanks and junk as 'no value', never as zero", () => {
    for (const bad of ["", "   ", "abc", "-5", null, undefined, -1]) expect(parseMoney(bad as never), String(bad)).toBeNull();
    expect(parseMoney("0")).toBe(0);
    expect(formatEur(null)).toBe("—");
  });
});

describe("pipeline vocabulary", () => {
  it("has the 14 stable statuses, each labelled", () => {
    expect(PROSPECT_STATUSES).toHaveLength(14);
    for (const s of PROSPECT_STATUSES) expect(STATUS_LABELS[s]).toBeTruthy();
    expect(STATUS_LABELS.ready_to_contact).toBe("Ready to contact");
  });
  it("keeps the groups consistent", () => {
    for (const s of OPPORTUNITY_STATUSES) {
      expect(REPLIED_STATUSES).toContain(s);
      expect(CLOSED_STATUSES).not.toContain(s);
    }
    expect(REPLIED_STATUSES).toContain("won");
  });
});

describe("prospect form", () => {
  const valid = { ...emptyProspectForm, companyName: "  Geert Kips ", email: "geert@geertkips.be", estimatedValue: "€ 1.500", nextFollowUpOn: "2026-11-06" };

  it("validates and normalises input", () => {
    const result = validateProspectForm(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toProspectRow(result.data)).toMatchObject({
      company_name: "Geert Kips",
      email: "geert@geertkips.be",
      estimated_value_eur: 1500,
      quote_value_eur: null,
      next_follow_up_on: "2026-11-06",
      sector: null,
      website_url: null,
      status: "new",
      priority: "normal",
      contact_delivery_status: "unknown",
    });
  });

  it("reports field errors", () => {
    const result = validateProspectForm({ ...emptyProspectForm, email: "nope", websiteUrl: "not a site", estimatedValue: "abc", firstContactOn: "2026-02-30" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["companyName", "email", "estimatedValue", "firstContactOn", "websiteUrl"]);
  });

  it("gives a bare domain https://", () => {
    expect(normalizeWebsite("vaultone.be")).toBe("https://vaultone.be");
    expect(normalizeWebsite("https://www.vaultone.be/")).toBe("https://www.vaultone.be/");
    expect(normalizeWebsite("javascript:alert(1)")).toBeNull();
    expect(normalizeWebsite("")).toBeNull();
  });

  it("is clean exactly when the values equal the saved snapshot (save disabled when clean)", () => {
    const saved = prospectToFormValues({
      company_name: "Geert Kips", sector: "Bouw", city: null, website_url: null, email: "geert@geertkips.be", contact_name: null, phone: null,
      status: "replied", priority: "normal", estimated_value_eur: null, quote_value_eur: null, first_contact_on: "2026-10-30",
      last_contact_on: "2026-10-31", next_follow_up_on: "2026-11-06", contact_delivery_status: "confirmed", source: null, notes: "Note",
    });
    expect(snapshotEqual(saved, { ...saved })).toBe(true);
    const edited = { ...saved, city: "Zedelgem" };
    expect(snapshotEqual(saved, edited)).toBe(false);
    // Changing it back makes it clean again.
    expect(snapshotEqual(saved, { ...edited, city: "" })).toBe(true);
  });
});

describe("euro display", () => {
  it("shows whole euros plainly and cents only when present", () => {
    expect(formatEur(1500).replace(/\s/g, " ")).toBe("€ 1.500");
    expect(formatEur(1500.5).replace(/\s/g, " ")).toBe("€ 1.500,50");
    expect(formatEur(0).replace(/\s/g, " ")).toBe("€ 0");
  });
});
