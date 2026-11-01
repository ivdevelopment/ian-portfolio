import { describe, expect, it } from "vitest";
import { domainLabel, suggestProspect, type CandidateProspect } from "@/lib/mail/zoho/candidates";

const prospects: CandidateProspect[] = [
  { id: "heyrick", company_name: "Garage Heyrick", email: null, website_url: null },
  { id: "nollet", company_name: "Auto's Nollet", email: null, website_url: "https://www.autosnollet.be/" },
  { id: "vault", company_name: "Vault One", email: "info@vaultone.be", website_url: "https://www.vaultone.be/" },
  { id: "twin-a", company_name: "Twin Studio", email: null, website_url: null },
  { id: "twin-b", company_name: "Twin  Studio BV", email: null, website_url: null },
];

describe("deterministic prospect suggestions for unmatched addresses", () => {
  it("proposes when the domain is the prospect's website host", () => {
    expect(suggestProspect("Sales@autosnollet.be", prospects)).toMatchObject({ prospect_id: "nollet", reason: "website host matches", hasEmail: false });
    expect(suggestProspect("jan@vaultone.be", prospects)).toMatchObject({ prospect_id: "vault", hasEmail: true });
  });
  it("proposes when the domain name equals the company name", () => {
    expect(suggestProspect("info@garage-heyrick.be", prospects)).toMatchObject({ prospect_id: "heyrick", reason: "domain equals company name" });
    expect(suggestProspect("info@garageheyrick.com", prospects)?.prospect_id).toBe("heyrick");
  });
  it("never proposes on similarity, shared providers, short labels or ambiguity", () => {
    expect(suggestProspect("info@heyrick-garage.be", prospects)).toBeNull();
    expect(suggestProspect("garage.heyrick@gmail.com", prospects)).toBeNull();
    expect(suggestProspect("someone@telenet.be", prospects)).toBeNull();
    expect(suggestProspect("info@twinstudio.be", prospects)).toBeNull(); // two prospects qualify
    expect(suggestProspect("a@abc.be", [{ id: "x", company_name: "Abc", email: null, website_url: null }])).toBeNull();
    expect(suggestProspect("not-an-address", prospects)).toBeNull();
  });
  it("reads the registrable label", () => {
    expect(domainLabel("x@mail.garage-heyrick.be")).toBe("garageheyrick");
    expect(domainLabel("x@firm.co.uk")).toBe("firm");
  });
});
