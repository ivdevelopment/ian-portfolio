// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prospects/p1", useSearchParams: () => new URLSearchParams() }));
vi.mock("server-only", () => ({}));

const actions = vi.hoisted(() => ({
  getMailAssistantViewAction: vi.fn(),
  requestMailRecommendationAction: vi.fn(),
  markMailDraftUsedAction: vi.fn(),
  dismissMailRecommendationAction: vi.fn(),
}));
vi.mock("@/crm/actions/mail-assistant", () => actions);
const status = vi.hoisted(() => ({ setStatusAction: vi.fn() }));
vi.mock("@/app/(admin)/admin/(panel)/prospects/actions", () => status);

import { MailAssistantPanel } from "@/components/crm/mail-assistant";
import { computeFingerprint } from "@/lib/mail-assistant/context";
import { computeFacts } from "@/lib/mail-assistant/facts";
import { decidePlan } from "@/lib/mail-assistant/plan";
import type { AssistantInputs, Plan } from "@/lib/mail-assistant/types";
import { buildAssistantView, type AgentInfo, type AssistantView, type RecommendationRow } from "@/lib/mail-assistant/view";

const NOW = new Date("2026-11-05T09:00:00Z"); // Thursday 10:00 in Brussels
const TODAY = "2026-11-05";
const base = (): AssistantInputs => ({
  now: NOW,
  prospect: { id: "p1", company_name: "Brugse Bike Rental", contact_name: "Sofie", sector: "bicycle rental", city: "Brugge", website_url: null, email: "info@x.be", status: "ready_to_contact", priority: "normal", source: null, first_contact_on: null, last_contact_on: null, next_follow_up_on: null },
  mail: [], activities: [], quotes: [], preview: null, insight: null, project: null,
});
const planOf = (i: AssistantInputs): Plan => decidePlan(computeFacts(i), i.now);
const online: AgentInfo = { registered: true, online: true, codexState: "ready", lastFailureKind: null };

const rowOf = (i: AssistantInputs, over: Partial<RecommendationRow> = {}): RecommendationRow => {
  const fp = computeFingerprint(i);
  return { id: "r1", status: "current", action_type: "first_outreach", recommended_send_at: TODAY, subject: "Een kleine suggestie", body: "Dag Sofie,\n\nIk had een kleine suggestie voor jullie reservatieflow.\n\nGroeten,\nIan", reason_summary: "Short angle on the reservation flow.", language: "nl", context_fingerprint: fp.fingerprint, fingerprint_parts: fp.parts, requested_at: "2026-11-05T08:00:00Z", generated_at: "2026-11-05T08:01:00Z", used_at: null, failure_kind: null, attempts: 1, ...over };
};
const viewOf = (i: AssistantInputs, rows: RecommendationRow[] = [], agent: AgentInfo | null = online, local = true): AssistantView => buildAssistantView({ prospectId: "p1", plan: planOf(i), fingerprint: computeFingerprint(i), today: TODAY, now: NOW, rows, agent, providerIsLocalCodex: local });

const sentMail = (id: string, direction: "incoming" | "outgoing", at: string, snippet = "Dag Sofie, ik kwam jullie website tegen en had een kleine suggestie voor de reservatieflow.") => ({ id, direction, subject: "Idee", snippet, sent_at: at });

/* ------------------------------------------------ the view model ------------------------------------------------ */

describe("what the tab shows, per situation", () => {
  it("never contacted: first outreach, today, with a Generate button when the agent is online", () => {
    const v = viewOf(base());
    expect(v.plan).toMatchObject({ actionLabel: "First outreach", timingLabel: "Today", reason: "No previous outreach found.", needsDraft: true });
    expect(v.generate).toMatchObject({ label: "Generate draft", enabled: true });
    expect(v.draft).toBeNull();
  });

  it("mail sent yesterday: Wait, with the follow-up date, and NO draft and NO generate button (no useless blank draft)", () => {
    const i = { ...base(), mail: [sentMail("m", "outgoing", "2026-11-04T10:00:00Z")] };
    const v = viewOf(i);
    expect(v.plan).toMatchObject({ actionLabel: "Wait", thenLabel: "Follow up", recommendedLabel: "9 Nov 2026", needsDraft: false });
    expect(v.plan.reason).toContain("yesterday");
    expect(v.generate).toBeNull();
    expect(v.draft).toBeNull();
  });

  it("an agent that is offline, or Codex that is not ready, disables Generate with the exact message (no paid fallback)", () => {
    const off = viewOf(base(), [], { ...online, online: false });
    expect(off.generate).toEqual({ label: "Generate draft", enabled: false, disabledReason: "Mail Assistant unavailable. Start Ian Prospect Agent on your PC." });
    expect(viewOf(base(), [], null).availability).toMatchObject({ state: "agent_offline" });
    expect(viewOf(base(), [], { ...online, codexState: "not_authenticated" }).generate?.disabledReason).toContain("sign in again");
    expect(viewOf(base(), [], online, false).availability).toMatchObject({ state: "disabled" });
  });

  it("an open request shows its stage, hides the button, and says when it seems stuck", () => {
    const queued = rowOf(base(), { status: "queued", subject: null, body: null, generated_at: null, action_type: null, requested_at: "2026-11-05T08:59:00Z" });
    expect(viewOf(base(), [queued]).job).toEqual({ id: "r1", stage: "waiting_agent", stuck: false });
    expect(viewOf(base(), [queued]).generate).toBeNull();
    expect(viewOf(base(), [{ ...queued, requested_at: "2026-11-05T08:50:00Z" }]).job?.stuck).toBe(true);
    expect(viewOf(base(), [{ ...queued, status: "generating" }]).job?.stage).toBe("generating");
  });

  it("a current draft for the same history is offered with Regenerate; after a new mail it is OUTDATED with a 'new mail activity' message", () => {
    const i = base();
    const row = rowOf(i);
    const fresh = viewOf(i, [row]);
    expect(fresh.draft).toMatchObject({ subject: "Een kleine suggestie", stale: { outdated: false } });
    expect(fresh.generate?.label).toBe("Regenerate");

    const after = { ...i, mail: [sentMail("m", "incoming", "2026-11-04T08:00:00Z", "Dag Ian, bedankt voor je bericht. Kunnen we volgende week eens bellen?")] };
    const v = viewOf(after, [row]);
    expect(v.draft?.stale).toMatchObject({ outdated: true, headline: "New mail activity detected" });
    expect(v.plan.actionLabel).toBe("Reply");
    expect(v.generate?.label).toBe("Refresh recommendation");
  });

  it("time passing can outdate a draft too: the follow-up draft is only right once the waiting period is over", () => {
    const i = { ...base(), mail: [sentMail("m", "outgoing", "2026-10-30T10:00:00Z")] };
    const row = rowOf(i, { action_type: "follow_up" });
    const ok = viewOf(i, [row]);
    expect(ok.plan.actionLabel).toBe("Follow up");
    expect(ok.draft?.stale.outdated).toBe(false);
    // The same history, but the plan now says to wait again (e.g. the draft was for a different step).
    const waiting = viewOf({ ...i, mail: [sentMail("m", "outgoing", "2026-11-04T10:00:00Z")] }, [{ ...row, context_fingerprint: computeFingerprint({ ...i, mail: [sentMail("m", "outgoing", "2026-11-04T10:00:00Z")] }).fingerprint }]);
    expect(waiting.draft?.stale).toMatchObject({ outdated: true, headline: "The timing has changed" });
    expect(waiting.generate).toBeNull();
  });

  it("a used draft stays visible only while nothing changed; after the synced mail it is history", () => {
    const i = base();
    const used = rowOf(i, { status: "used", used_at: "2026-11-05T09:00:00Z" });
    expect(viewOf(i, [used]).draft).toMatchObject({ used: true });
    expect(viewOf({ ...i, mail: [sentMail("m", "outgoing", "2026-11-05T09:30:00Z")] }, [used]).draft).toBeNull();
  });

  it("a failed request is explained plainly, and Generate is available again", () => {
    const failed = rowOf(base(), { status: "failed", failure_kind: "codex_usage_limit", subject: null, body: null, generated_at: null, action_type: null });
    const v = viewOf(base(), [failed]);
    expect(v.failure?.message).toContain("usage limit");
    expect(v.generate?.enabled).toBe(true);
  });

  it("a reply with too little stored text says 'More email context needed' and offers no draft", () => {
    const i = { ...base(), mail: [sentMail("o", "outgoing", "2026-10-30T10:00:00Z"), sentMail("i", "incoming", "2026-11-04T08:00:00Z", "ok")] };
    const v = viewOf(i);
    expect(v.plan).toMatchObject({ actionLabel: "Reply", blocked: "more_context_needed", needsDraft: false });
    expect(v.generate).toBeNull();
  });

  it.each(["lost", "not_interested", "won", "no_response"] as const)("status %s: no action, no draft, no button", (status) => {
    const v = viewOf({ ...base(), prospect: { ...base().prospect, status } });
    expect(v.plan).toMatchObject({ actionLabel: "No action", needsDraft: false });
    expect(v.generate).toBeNull();
  });
});

/* ------------------------------------------------ the component ------------------------------------------------ */

const flush = () => act(async () => {});
const writeText = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  writeText.mockResolvedValue(undefined);
  status.setStatusAction.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const panel = (v: AssistantView, st: "ready_to_contact" | "contacted" = "ready_to_contact") => render(<MailAssistantPanel initial={v} prospectStatus={st} />);

describe("the Mail Assistant tab", () => {
  it("first outreach: shows the action, timing and why; Generate queues ONE request and shows the waiting state", async () => {
    const i = base();
    const waiting = viewOf(i, [rowOf(i, { status: "queued", subject: null, body: null, generated_at: null, action_type: null })]);
    actions.requestMailRecommendationAction.mockResolvedValue({ ok: true, alreadyOpen: false });
    actions.getMailAssistantViewAction.mockResolvedValue({ ok: true, view: waiting });
    panel(viewOf(i));
    expect(screen.getByText("First outreach")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("No previous outreach found.")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull(); // no blank draft before one exists
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await flush();
    expect(actions.requestMailRecommendationAction).toHaveBeenCalledTimes(1);
    expect(actions.requestMailRecommendationAction).toHaveBeenCalledWith("p1");
    expect(screen.getByText("Waiting for Ian Prospect Agent…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate draft" })).toBeNull(); // no second click while one is open
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeTruthy();
  });

  it("shows 'Checking history…' while the request is being made, then the real stages, then 'Draft ready'", async () => {
    vi.useFakeTimers();
    const i = base();
    let release!: () => void;
    actions.requestMailRecommendationAction.mockReturnValue(new Promise((r) => (release = () => r({ ok: true, alreadyOpen: false }))));
    const generating = viewOf(i, [rowOf(i, { status: "generating", subject: null, body: null, generated_at: null, action_type: null })]);
    const ready = viewOf(i, [rowOf(i)]);
    actions.getMailAssistantViewAction.mockResolvedValueOnce({ ok: true, view: generating }).mockResolvedValue({ ok: true, view: ready });
    panel(viewOf(i));
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await flush();
    expect(screen.getByText("Checking history…")).toBeTruthy();
    release();
    await flush();
    expect(screen.getByText("Generating draft…")).toBeTruthy();
    await act(async () => void (await vi.advanceTimersByTimeAsync(3100)));
    expect(screen.getByText("Draft ready")).toBeTruthy();
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Een kleine suggestie");
    expect((screen.getByLabelText("Email") as HTMLTextAreaElement).value).toContain("kleine suggestie voor jullie reservatieflow");
  });

  it("polls only while a request is open", async () => {
    vi.useFakeTimers();
    panel(viewOf(base()));
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(actions.getMailAssistantViewAction).not.toHaveBeenCalled();
  });

  it("the draft is editable, and what Ian types is never overwritten by a refresh", async () => {
    const i = base();
    const v = viewOf(i, [rowOf(i)]);
    actions.markMailDraftUsedAction.mockResolvedValue({ ok: true });
    actions.getMailAssistantViewAction.mockResolvedValue({ ok: true, view: viewOf(i, [rowOf(i, { status: "used", used_at: "2026-11-05T09:05:00Z" })]) });
    panel(v);
    const subject = screen.getByLabelText("Subject") as HTMLInputElement;
    const body = screen.getByLabelText("Email") as HTMLTextAreaElement;
    fireEvent.change(subject, { target: { value: "Mijn eigen onderwerp" } });
    fireEvent.change(body, { target: { value: "Mijn eigen tekst." } });
    fireEvent.click(screen.getByRole("button", { name: "Mark as used" }));
    await flush();
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Mijn eigen onderwerp");
    expect((screen.getByLabelText("Email") as HTMLTextAreaElement).value).toBe("Mijn eigen tekst.");
  });

  it("copies the EDITED subject, body or both, with success feedback, and says so when the browser refuses", async () => {
    const i = base();
    panel(viewOf(i, [rowOf(i)]));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Onderwerp X" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Tekst Y" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy subject" }));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith("Onderwerp X");
    expect(screen.getByText("Copied")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy body" }));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith("Tekst Y");
    fireEvent.click(screen.getByRole("button", { name: "Copy both" }));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith("Onderwerp X\n\nTekst Y");
    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy subject" }));
    await flush();
    expect(screen.getByText(/Copy failed/)).toBeTruthy();
  });

  it("Regenerate, Dismiss and Mark as used are offered; Dismiss calls the action and does not touch the prospect", async () => {
    const i = base();
    actions.dismissMailRecommendationAction.mockResolvedValue({ ok: true });
    actions.getMailAssistantViewAction.mockResolvedValue({ ok: true, view: viewOf(i, []) });
    panel(viewOf(i, [rowOf(i)]));
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await flush();
    expect(actions.dismissMailRecommendationAction).toHaveBeenCalledWith("r1");
    expect(status.setStatusAction).not.toHaveBeenCalled();
  });

  it("waiting: shows Wait, the next step and the date, and has no textarea, no copy buttons and no generate button", () => {
    panel(viewOf({ ...base(), mail: [sentMail("m", "outgoing", "2026-11-04T10:00:00Z")] }));
    expect(screen.getByText("Wait")).toBeTruthy();
    expect(screen.getByText("Then: follow up")).toBeTruthy();
    expect(screen.getByText("Recommended follow-up")).toBeTruthy();
    expect(screen.getByText("9 Nov 2026")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy|Generate|Regenerate/ })).toBeNull();
  });

  it("an outdated draft says what changed, asks for a refresh, and offers NO copy buttons (only a collapsed look at it)", () => {
    const i = base();
    const row = rowOf(i);
    const later = { ...i, mail: [sentMail("m", "incoming", "2026-11-04T08:00:00Z", "Dag Ian, bedankt voor je bericht. Kunnen we volgende week eens bellen?")] };
    panel(viewOf(later, [row]));
    expect(screen.getByText("New mail activity detected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh recommendation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Copy/ })).toBeNull();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByText("Show the outdated draft")).toBeTruthy();
  });

  it("agent offline: a clear message and a disabled button, never a paid fallback", () => {
    panel(viewOf(base(), [], { ...online, online: false }));
    expect(screen.getByText("Mail Assistant unavailable. Start Ian Prospect Agent on your PC.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Generate draft" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a reply that cannot be answered safely says 'More email context needed'", () => {
    panel(viewOf({ ...base(), mail: [sentMail("o", "outgoing", "2026-10-30T10:00:00Z"), sentMail("i", "incoming", "2026-11-04T08:00:00Z", "ok")] }));
    expect(screen.getByText(/More email context needed\. The CRM keeps only a short snippet/)).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("after 'Mark as used' it does not claim the mail was sent, points to the Zoho sync, and offers 'Mark prospect as Contacted?' only for a not-yet-contacted prospect", async () => {
    const i = base();
    const used = viewOf(i, [rowOf(i, { status: "used", used_at: "2026-11-05T09:05:00Z" })]);
    panel(used);
    expect(screen.getByText(/does not mean the mail was sent/)).toBeTruthy();
    expect(screen.getByText("Sync now on the Email tab").getAttribute("href")).toContain("tab=email");
    expect(screen.queryByRole("button", { name: "Mark as used" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark as Contacted" }));
    await flush();
    expect(status.setStatusAction).toHaveBeenCalledWith("p1", "contacted");
    expect(screen.getByText("The prospect is now marked as Contacted.")).toBeTruthy();
    cleanup();
    panel(used, "contacted");
    expect(screen.queryByRole("button", { name: "Mark as Contacted" })).toBeNull();
  });

  it("an error from the server is shown, and a stuck request says so", async () => {
    const i = base();
    actions.requestMailRecommendationAction.mockResolvedValue({ ok: false, error: "Mail Assistant unavailable. Start Ian Prospect Agent on your PC." });
    actions.getMailAssistantViewAction.mockResolvedValue({ ok: true, view: viewOf(i) });
    panel(viewOf(i));
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await flush();
    expect(screen.getAllByText("Mail Assistant unavailable. Start Ian Prospect Agent on your PC.").length).toBeGreaterThan(0);
    cleanup();
    panel(viewOf(i, [rowOf(i, { status: "queued", subject: null, body: null, generated_at: null, action_type: null, requested_at: "2026-11-05T08:50:00Z" })]));
    expect(screen.getByText("Still waiting. Is Ian Prospect Agent running on your PC?")).toBeTruthy();
  });

  it("the page never mentions scores, tracking or analysis in its own wording", () => {
    const i = base();
    panel(viewOf({ ...i, preview: { linked: true, id: "pv", firstAccessedAt: "2026-11-02T14:37:00Z", lastAccessedAt: "2026-11-03T09:00:00Z", accessCount: 4 } }));
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/14:37|viewed|score|openstreetmap|osm/i);
  });
});
