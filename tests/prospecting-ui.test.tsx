// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const router = { refresh, push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prospecting", useSearchParams: () => new URLSearchParams() }));
vi.mock("server-only", () => ({}));

const actions = vi.hoisted(() => ({ startDiscoveryAction: vi.fn(), getRunStatusAction: vi.fn(), addDiscoveryCandidateAction: vi.fn(), ignoreDiscoveryCandidateAction: vi.fn() }));
vi.mock("@/crm/actions/prospecting", () => actions);

import { AiProviderPanel } from "@/components/crm/ai-provider-panel";
import { DiscoveryCandidateCard } from "@/components/crm/discovery-candidate-card";
import { ProspectFinder } from "@/components/crm/prospect-finder";
import { AppPathsProvider } from "@/lib/crm/paths-context";
import { getProviderStatus } from "@/lib/prospecting/config";
import type { CandidateView, RunRow } from "@/lib/prospecting/service";

const flush = () => act(async () => {});
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const cat = (score: number, max: number, reason: string) => ({ score, max, reason, observations: ["o1"] });
const candidate = (over: Partial<CandidateView> = {}): CandidateView => ({
  id: "c1", run_id: "r1", company_name: "Thierry Bike Repair", website_url: "https://thierrybikerepair.be", domain: "thierrybikerepair.be", email: "info@thierrybikerepair.be", phone: null, city: "Brugge", region: "West-Vlaanderen", industry: "Bike repair",
  score: 86,
  breakdown: { business_fit: cat(20, 25, "Local service business."), website_need: cat(18, 25, "No mobile viewport tag."), conversion_gap: cat(12, 15, "No quote request found."), service_opportunity: cat(12, 15, "A quote flow fits."), local_relevance: cat(10, 10, "Located in Brugge."), contactability: cat(8, 10, "Email found.") },
  summary: "Modernisation opportunity.", opportunity: "Website redesign + quote request flow",
  evidence: [{ id: "o1", url: "https://thierrybikerepair.be/", title: "Home", fact: "No quote request or enquiry form was found on the pages checked (2 pages checked).", at: "2026-11-05T09:00:00.000Z" }],
  source_urls: ["https://directory.be/x"], synthetic: false, status: "pending", duplicate_of: null, duplicate_reason: null, created_at: "2026-11-05T09:00:00.000Z", added_prospect_id: null,
  reasons: ["No mobile viewport tag.", "No quote request found."],
  ...over,
});
const run = (over: Partial<RunRow> = {}): RunRow => ({ id: "r1", mode: "redesign", location: "Brugge", area: null, industry: null, threshold: 70, requested_count: 10, status: "completed", stage: "1 strong prospect found", provider: "mock", raw_found: 7, analyzed: 6, qualified: 1, duplicates_removed: 1, skipped_cooldown: 0, errors: [], started_at: "2026-11-05T09:00:00.000Z", finished_at: "2026-11-05T09:01:00.000Z", failure_kind: null, lease_expires_at: null, cancel_requested: false, codex_ms: null, codex_calls: null, ...over });

const finder = (props: Partial<React.ComponentProps<typeof ProspectFinder>> = {}) =>
  render(
    <AppPathsProvider kind="crm">
      <ProspectFinder ready runs={[]} candidates={[]} duplicates={[]} {...props} />
    </AppPathsProvider>,
  );

describe("provider status", () => {
  it("when no provider is connected it says so plainly, explains the boundary and offers no button that cannot work", () => {
    render(<AiProviderPanel status={getProviderStatus({})} />);
    expect(screen.getByText(/AI prospecting is not connected yet/)).toBeTruthy();
    expect(screen.getByText(/requires an approved Sign in with ChatGPT integration/)).toBeTruthy();
    expect(screen.getByText("Connection info")).toBeTruthy();
    expect(screen.getByText(/conversations, memories or files/)).toBeTruthy();
    expect(screen.getByText(/never uses a normal OpenAI API key/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("marks the development sample provider as sample data", () => {
    render(<AiProviderPanel status={getProviderStatus({ AI_PROSPECTING_PROVIDER: "mock", NODE_ENV: "development" })} compact />);
    expect(screen.getByText("Sample data (development)")).toBeTruthy();
    expect(screen.getByText(/invented sample businesses/)).toBeTruthy();
  });
});

describe("Find prospects", () => {
  it("shows no Find button when AI is not connected, but still lists the history and waiting candidates", () => {
    finder({ ready: false, runs: [run()], candidates: [candidate()] });
    expect(screen.queryByRole("button", { name: "Find prospects" })).toBeNull();
    expect(screen.getByText("Thierry Bike Repair")).toBeTruthy();
    expect(screen.getByText(/Recent searches/)).toBeTruthy();
  });

  it("defaults to Brugge, a 70 minimum score and 'skip researched', and mode sets a sensible result count", () => {
    finder();
    expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("Brugge");
    expect((screen.getByLabelText("Radius / area") as HTMLInputElement).value).toBe("Brugge + 30 km");
    expect((screen.getByLabelText("Minimum score (0–100)") as HTMLInputElement).value).toBe("70");
    expect((screen.getByLabelText("Skip businesses already researched") as HTMLInputElement).checked).toBe(true);
    for (const m of ["Quick Find", "Deep Find", "No Website", "Website Redesign", "Web App Opportunity", "Industry Hunt"]) expect(screen.getByText(m)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Quick Find"));
    expect((screen.getByLabelText("Maximum results") as HTMLInputElement).value).toBe("5");
    fireEvent.click(screen.getByLabelText("Deep Find"));
    expect((screen.getByLabelText("Maximum results") as HTMLInputElement).value).toBe("15");
  });

  it("starts a run with the chosen settings, shows real stages and counters while it runs, then the candidates, without fake percentages", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    actions.startDiscoveryAction.mockResolvedValue({ ok: true, runId: "r1" });
    actions.getRunStatusAction
      .mockResolvedValueOnce({ run: run({ status: "running", stage: "Analyzing 5 websites…", raw_found: 9, analyzed: 2, qualified: 0, finished_at: null }), candidates: [] })
      .mockResolvedValue({ run: run(), candidates: [candidate()] });
    finder();
    fireEvent.change(screen.getByLabelText("Minimum score (0–100)"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Find prospects" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(actions.startDiscoveryAction).toHaveBeenCalledWith({ mode: "redesign", location: "Brugge", area: "Brugge + 30 km", industry: null, count: 10, threshold: 75, excludeResearched: true });
    expect(screen.getByText("Analyzing 5 websites…")).toBeTruthy();
    expect(screen.getByText(/9 found · 1 already known · 2 analysed/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d+\s?%/);
    expect((screen.getByRole("button", { name: /Searching…/ }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.getByText("1 strong prospect found")).toBeTruthy();
    expect(screen.getByText("Thierry Bike Repair")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Find prospects" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says why a run could not start", async () => {
    actions.startDiscoveryAction.mockResolvedValue({ ok: false, error: "A search is already running. Wait for it to finish." });
    finder();
    fireEvent.click(screen.getByRole("button", { name: "Find prospects" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("already running");
  });

  it("sorts waiting candidates by score by default and can sort by newest", () => {
    finder({ candidates: [candidate({ id: "a", company_name: "Low", score: 72, created_at: "2026-11-06T00:00:00Z" }), candidate({ id: "b", company_name: "High", score: 91, created_at: "2026-11-04T00:00:00Z" })] });
    const names = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names()).toEqual(["High", "Low"]);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "newest" } });
    expect(names()).toEqual(["Low", "High"]);
  });

  it("lists businesses that were already in the CRM separately, with a link", () => {
    finder({ duplicates: [candidate({ id: "d", company_name: "Garage Heyrick", status: "rejected_duplicate", duplicate_of: "p1", duplicate_reason: "Already in the CRM (same email as Garage Heyrick)" })] });
    expect(screen.getByText(/Already in the CRM \(1\)/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/prospects/p1");
  });
});

describe("candidate card", () => {
  const onDone = vi.fn();
  const card = (over: Partial<CandidateView> = {}) => render(<ul><DiscoveryCandidateCard item={candidate(over)} onDone={onDone} /></ul>);

  it("shows the score, neutral reasons, the potential service, contact and the evidence with its source", () => {
    card();
    expect(screen.getByText("86")).toBeTruthy();
    expect(screen.getByText("Why this is interesting")).toBeTruthy();
    expect(screen.getAllByText("No mobile viewport tag.").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Website redesign \+ quote request flow/)).toBeTruthy();
    expect(screen.getByText("info@thierrybikerepair.be")).toBeTruthy();
    expect(screen.getByText("Score breakdown and evidence")).toBeTruthy();
    expect(screen.getByText(/No quote request or enquiry form was found on the pages checked/)).toBeTruthy();
    const open = screen.getAllByRole("link", { name: /thierrybikerepair\.be|Open website/ });
    for (const a of open) expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("marks sample data and never links to a sample website", () => {
    card({ synthetic: true, website_url: "https://sample.invalid/", company_name: "Sample (sample data)" });
    expect(screen.getByText("Sample data")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open website/ })).toBeNull();
  });

  it("Add prospect runs once, shows progress and reports the new prospect as Researching", async () => {
    let resolve!: (v: unknown) => void;
    actions.addDiscoveryCandidateAction.mockReturnValue(new Promise((r) => (resolve = r)));
    card();
    fireEvent.click(screen.getByRole("button", { name: "Add prospect" }));
    await flush();
    const busy = screen.getByRole("button", { name: /Adding…/ }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Ignore" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    expect(actions.addDiscoveryCandidateAction).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true, prospectId: "p5", company: "Thierry Bike Repair" }));
    expect(onDone).toHaveBeenCalledWith({ id: "c1", text: "Added as prospect (Researching): Thierry Bike Repair.", prospectId: "p5" });
  });

  it("Ignore records the decision and shows the server's message when something fails", async () => {
    actions.ignoreDiscoveryCandidateAction.mockResolvedValueOnce({ ok: false, error: "This candidate was already decided." }).mockResolvedValueOnce({ ok: true });
    card();
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("already decided");
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    await flush();
    expect(onDone).toHaveBeenCalledWith({ id: "c1", text: expect.stringContaining("will not be suggested again") });
  });
});
