// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const router = { refresh, push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prospecting", useSearchParams: () => new URLSearchParams() }));
vi.mock("server-only", () => ({}));

const actions = vi.hoisted(() => ({
  startDiscoveryAction: vi.fn(),
  getRunStatusAction: vi.fn(),
  addDiscoveryCandidateAction: vi.fn(),
  ignoreDiscoveryCandidateAction: vi.fn(),
  cancelDiscoveryRunAction: vi.fn(),
  createAgentTokenAction: vi.fn(),
  revokeAgentAction: vi.fn(),
}));
vi.mock("@/crm/actions/prospecting", () => actions);

import { AgentSummary, relativeTime } from "@/components/crm/agent-status";
import { AiProviderPanel } from "@/components/crm/ai-provider-panel";
import { LocalAgentPanel } from "@/components/crm/local-agent-panel";
import { ProspectFinder } from "@/components/crm/prospect-finder";
import { AppPathsProvider } from "@/lib/crm/paths-context";
import type { AgentStatus } from "@/lib/prospecting/agent/service";
import { AGENT_OFFLINE_MESSAGE, getProviderStatus } from "@/lib/prospecting/config";
import type { RunRow } from "@/lib/prospecting/service";

const flush = () => act(async () => {});
/** Lets the clock hook (which starts on a zero-delay timer) tick once. */
const tick = () => act(async () => new Promise<void>((r) => setTimeout(r, 30)));
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const now = Date.now();
const agent = (over: Partial<AgentStatus> = {}): AgentStatus => ({ id: "a1", name: "Ian-PC", hint: "ipa_AbCd", createdAt: new Date(now - 86_400_000).toISOString(), lastSeenAt: new Date(now - 5000).toISOString(), online: true, codexVersion: "0.46.1", codexState: "ready", lastFailureKind: null, ...over });
const env = { AI_PROSPECTING_PROVIDER: "local_codex" };
const run = (over: Partial<RunRow> = {}): RunRow => ({ id: "r1", mode: "quick", location: "Brugge", area: null, industry: null, threshold: 70, requested_count: 5, status: "completed", stage: "3 strong prospects found", provider: "local_codex", raw_found: 12, analyzed: 8, qualified: 3, duplicates_removed: 1, skipped_cooldown: 0, errors: [], started_at: "2026-11-06T09:00:00.000Z", finished_at: "2026-11-06T09:05:00.000Z", failure_kind: null, lease_expires_at: null, cancel_requested: false, codex_ms: null, codex_calls: null, ...over });

describe("provider state for the local agent", () => {
  it("is not ready until a device is registered, online and its Codex is usable, and says what to do in each case", () => {
    expect(getProviderStatus(env, null)).toMatchObject({ ready: false, queued: true, flag: "local_codex" });
    expect(getProviderStatus(env, null).message).toMatch(/No local agent is registered/);
    const offline = getProviderStatus(env, { name: "Ian-PC", online: false, codexState: "ready" });
    expect(offline).toMatchObject({ ready: false, message: AGENT_OFFLINE_MESSAGE });
    expect(AGENT_OFFLINE_MESSAGE).toBe("Local AI agent is offline. Start Ian Prospect Agent on your PC.");
    expect(getProviderStatus(env, { name: "Ian-PC", online: true, codexState: "not_authenticated" })).toMatchObject({ ready: false, message: expect.stringContaining("not signed in with ChatGPT") });
    expect(getProviderStatus(env, { name: "Ian-PC", online: true, codexState: "not_installed" }).message).toMatch(/not installed/);
    expect(getProviderStatus(env, { name: "Ian-PC", online: true, codexState: "ready" })).toMatchObject({ ready: true, queued: true, label: "Local AI agent: Ian-PC connected" });
  });

  it("the other states are unchanged: disabled stays disabled, the sample stays local-only", () => {
    expect(getProviderStatus({}, null)).toMatchObject({ ready: false, flag: "disabled", queued: false });
    expect(getProviderStatus({ AI_PROSPECTING_PROVIDER: "mock", NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" }, null)).toMatchObject({ ready: false });
  });
});

describe("agent status", () => {
  it("connected: device, last heartbeat, provider and Codex version", async () => {
    render(<AgentSummary agent={agent()} />);
    await tick();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Ian-PC")).toBeTruthy();
    expect(screen.getByText("Codex / ChatGPT")).toBeTruthy();
    expect(screen.getByText(/seconds ago|just now/)).toBeTruthy();
    expect(screen.getByText("0.46.1")).toBeTruthy();
  });

  it("offline after 90 seconds without a heartbeat: says to start the agent and does not claim to be connected", async () => {
    render(<AgentSummary agent={agent({ online: false, lastSeenAt: new Date(now - 10 * 60_000).toISOString() })} />);
    await tick();
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("Start Ian Prospect Agent on your computer.")).toBeTruthy();
    expect(screen.getByText(/10 minutes ago/)).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("needs attention when connected but Codex is not signed in", async () => {
    render(<AgentSummary agent={agent({ codexState: "not_authenticated", lastFailureKind: "codex_not_authenticated" })} />);
    await flush();
    expect(screen.getByText("Not signed in with ChatGPT")).toBeTruthy();
  });

  it("not set up", () => {
    render(<AgentSummary agent={null} />);
    expect(screen.getByText(/Not set up/)).toBeTruthy();
  });

  it("relative time reads naturally", () => {
    const n = Date.parse("2026-11-06T12:00:00Z");
    expect(relativeTime(null, n)).toBe("never");
    expect(relativeTime("2026-11-06T11:59:57Z", n)).toBe("just now");
    expect(relativeTime("2026-11-06T11:59:30Z", n)).toBe("30 seconds ago");
    expect(relativeTime("2026-11-06T11:58:00Z", n)).toBe("2 minutes ago");
    expect(relativeTime("2026-11-06T10:00:00Z", n)).toBe("2 hours ago");
  });

  it("the provider panel shows the agent when the queue is in use", async () => {
    render(<AiProviderPanel status={getProviderStatus(env, { name: "Ian-PC", online: false, codexState: "ready" })} agent={agent({ online: false, lastSeenAt: new Date(Date.now() - 600_000).toISOString() })} compact />);
    await tick();
    expect(screen.getByText(AGENT_OFFLINE_MESSAGE)).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
  });
});

describe("Settings: Local Prospect Agent", () => {
  const panel = (a: AgentStatus | null = null, flagOn = true) => render(<LocalAgentPanel agent={a} flagOn={flagOn} />);

  it("lists the four setup steps and has no secret to show before a token is made", () => {
    panel();
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatch(/^1Install Codex CLI/);
    expect(steps[1]).toMatch(/^2Sign in with ChatGPT/);
    expect(steps[2]).toMatch(/^3Install Ian Prospect Agent/);
    expect(steps[3]).toMatch(/^4Connect this device/);
    expect(screen.getByRole("button", { name: "Generate connection token" })).toBeTruthy();
    expect(screen.queryByTestId("agent-token")).toBeNull();
    expect(screen.queryByRole("button", { name: /Revoke/ })).toBeNull();
  });

  it("shows the new token ONCE with a warning, then hides it for good", async () => {
    const token = `ipa_${"Q".repeat(43)}`;
    actions.createAgentTokenAction.mockResolvedValue({ ok: true, token, name: "Ian-PC" });
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Generate connection token" }));
    await flush();
    expect(actions.createAgentTokenAction).toHaveBeenCalledWith("Ian-PC");
    expect(screen.getByTestId("agent-token").textContent).toBe(token);
    expect(screen.getByText(/shown only once/)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /I have saved it/ }));
    expect(screen.queryByTestId("agent-token")).toBeNull();
    expect(document.body.textContent).not.toContain(token);
  });

  it("generating again says the old token stops working; revoking needs a second click and then confirms", async () => {
    actions.revokeAgentAction.mockResolvedValue({ ok: true });
    panel(agent());
    expect(screen.getByRole("button", { name: "Generate new token" })).toBeTruthy();
    expect(screen.getByText(/old token stops working immediately/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revoke device" }));
    expect(actions.revokeAgentAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Confirm: revoke Ian-PC/ }));
    await flush();
    expect(actions.revokeAgentAction).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the server's message when it fails and warns when the finder is not switched on", async () => {
    actions.createAgentTokenAction.mockResolvedValue({ ok: false, error: "That couldn't be saved. Please try again." });
    panel(null, false);
    expect(screen.getByText(/not switched on for this CRM yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate connection token" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("couldn't be saved");
  });
});

const finder = (props: Partial<React.ComponentProps<typeof ProspectFinder>> = {}) =>
  render(
    <AppPathsProvider kind="crm">
      <ProspectFinder ready runs={[]} candidates={[]} duplicates={[]} {...props} />
    </AppPathsProvider>,
  );

describe("Find prospects with the local agent", () => {
  it("offline: no Find button, the history is still there", () => {
    finder({ ready: false, runs: [run()] });
    expect(screen.queryByRole("button", { name: "Find prospects" })).toBeNull();
    expect(screen.getByText(/Recent searches/)).toBeTruthy();
  });

  it("queued -> picked up -> finding -> analysing -> qualifying -> done, with the real stage text at every step and a Cancel button while it lasts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    actions.startDiscoveryAction.mockResolvedValue({ ok: true, runId: "r1" });
    const states = [
      run({ status: "queued", stage: "Queued, waiting for the agent…", finished_at: null, qualified: 0, raw_found: 0, analyzed: 0 }),
      run({ status: "claimed", stage: "Picked up by Ian-PC", finished_at: null, qualified: 0, raw_found: 0, analyzed: 0 }),
      run({ status: "discovering", stage: "Finding businesses…", finished_at: null, qualified: 0, raw_found: 0, analyzed: 0 }),
      run({ status: "analyzing", stage: "Analyzing 5 websites…", finished_at: null, qualified: 0, raw_found: 12, analyzed: 2 }),
      run({ status: "qualifying", stage: "Qualifying candidates…", finished_at: null, qualified: 1, raw_found: 12, analyzed: 8 }),
      run(),
    ];
    for (const s of states) actions.getRunStatusAction.mockResolvedValueOnce({ run: s, candidates: [] });
    finder();
    fireEvent.click(screen.getByRole("button", { name: "Find prospects" }));
    const seen: string[] = [];
    for (let i = 0; i < states.length; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(i === 0 ? 100 : 2100);
      });
      seen.push(screen.getByRole("status").textContent ?? "");
    }
    expect(seen[0]).toContain("Queued, waiting for the agent…");
    expect(seen[1]).toContain("Picked up by Ian-PC");
    expect(seen[2]).toContain("Finding businesses…");
    expect(seen[3]).toContain("Analyzing 5 websites…");
    expect(seen[4]).toContain("Qualifying candidates…");
    expect(seen[5]).toContain("3 strong prospects found");
    expect(seen[0]).toContain("Cancel run");
    expect(seen[5]).not.toContain("Cancel run");
    expect(seen.join(" ")).not.toMatch(/\d+\s?%/);
    expect(refresh).toHaveBeenCalled();
  });

  it("Cancel run asks the CRM to cancel and shows it is cancelling", async () => {
    actions.cancelDiscoveryRunAction.mockResolvedValue({ ok: true });
    actions.getRunStatusAction.mockResolvedValue({ run: run({ status: "analyzing", stage: "Analyzing 5 websites…", finished_at: null }), candidates: [] });
    finder({ activeRunId: "r1" });
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    await flush();
    expect(actions.cancelDiscoveryRunAction).toHaveBeenCalledWith("r1");
    expect(screen.getByRole("button", { name: /Cancelling…/ })).toBeTruthy();
  });

  it("a search still running when the page opens is picked up again", async () => {
    actions.getRunStatusAction.mockResolvedValue({ run: run({ status: "qualifying", stage: "Qualifying candidates…", finished_at: null }), candidates: [] });
    finder({ activeRunId: "r1" });
    await flush();
    expect(actions.getRunStatusAction).toHaveBeenCalledWith("r1");
    expect(screen.getByText("Qualifying candidates…")).toBeTruthy();
  });

  it("usage exhausted: shows the exact message and does not offer any other way to run it", async () => {
    actions.getRunStatusAction.mockResolvedValue({ run: run({ status: "failed", stage: "Run stopped", failure_kind: "codex_usage_limit", qualified: 0 }), candidates: [] });
    finder({ activeRunId: "r1" });
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("Your current Codex/ChatGPT usage limit has been reached. Try again when your allowance resets.");
    expect(document.body.textContent).not.toMatch(/API key|billing|fallback/i);
  });

  it("partial and failed runs say why in the history; cancelled and queued runs are labelled", () => {
    finder({ ready: false, runs: [run({ id: "a", status: "partial", failure_kind: "codex_usage_limit" }), run({ id: "b", status: "failed", failure_kind: "codex_timeout" }), run({ id: "c", status: "cancelled", failure_kind: null }), run({ id: "d", status: "queued", finished_at: null })] });
    expect(screen.getByText("Partial")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.getByText(/usage limit has been reached/)).toBeTruthy();
    expect(screen.getByText("Codex took too long and was stopped.")).toBeTruthy();
  });
});
