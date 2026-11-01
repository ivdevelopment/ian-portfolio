// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
let pathname = "/prospects/abc";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const prospects = vi.hoisted(() => ({ completeFollowUpAction: vi.fn(), setFollowUpAction: vi.fn(), setStatusAction: vi.fn() }));
vi.mock("@/app/(admin)/admin/(panel)/prospects/actions", () => prospects);
vi.mock("@/app/(admin)/admin/(panel)/settings/integrations/actions", () => ({ zohoSyncNowAction: vi.fn() }));

import { CrmNav } from "@/components/crm/crm-nav";
import { FollowUpRow } from "@/components/crm/follow-up-row";
import { Timeline } from "@/components/crm/timeline";
import { AppPathsProvider } from "@/lib/crm/paths-context";
import { crmPaths } from "@/lib/crm/paths";
import { mergeTimeline } from "@/lib/mail/timeline";

const flush = () => act(async () => {});
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("CrmNav", () => {
  it("links to the CRM's own URLs (no /admin) and marks the current section", () => {
    pathname = "/prospects/abc";
    render(<CrmNav />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/", "/prospects", "/pipeline", "/follow-ups", "/clients", "/quotes", "/projects", "/settings"]);
    expect(links.find((l) => l.getAttribute("aria-current") === "page")?.textContent).toBe("Prospects");
    expect(links.some((l) => (l.getAttribute("href") ?? "").includes("/admin"))).toBe(false);
  });

  it("closes the mobile drawer when a destination is chosen", () => {
    const onNavigate = vi.fn();
    render(<CrmNav onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: "Quotes" }));
    expect(onNavigate).toHaveBeenCalled();
  });
});

describe("FollowUpRow", () => {
  const item = { id: "p1", company: "Garage Heyrick", status: "contacted" as const, priority: "normal", day: "2026-11-01", lastActivity: "Mail sent" };
  const row = () =>
    render(
      <AppPathsProvider kind="crm">
        <ul>
          <FollowUpRow item={item} today="2026-11-02" />
        </ul>
      </AppPathsProvider>,
    );

  it("opens the prospect inside the CRM", () => {
    row();
    expect(screen.getByRole("link", { name: "Garage Heyrick" }).getAttribute("href")).toBe("/prospects/p1");
  });

  it("completing shows 'Completing…', cannot be repeated, then returns", async () => {
    const pending = deferred<{ ok: true }>();
    prospects.completeFollowUpAction.mockReturnValue(pending.promise);
    row();
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    await flush();
    const busy = screen.getByRole("button", { name: /Completing…/ }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Reschedule/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    expect(prospects.completeFollowUpAction).toHaveBeenCalledTimes(1);
    expect(prospects.completeFollowUpAction).toHaveBeenCalledWith("p1", null);
    await act(async () => pending.resolve({ ok: true }));
    expect(refresh).toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Done/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("rescheduling uses the preset relative to today", async () => {
    prospects.setFollowUpAction.mockResolvedValue({ ok: true });
    row();
    fireEvent.click(screen.getByRole("button", { name: /Reschedule/ }));
    fireEvent.click(screen.getByRole("button", { name: "3 days" }));
    await flush();
    expect(prospects.setFollowUpAction).toHaveBeenCalledWith("p1", "2026-11-05");
  });

  it("shows the server's message when it fails, and also recovers from a network error", async () => {
    prospects.completeFollowUpAction.mockResolvedValueOnce({ ok: false, error: "Prospect not found." });
    row();
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("Prospect not found.");
    prospects.completeFollowUpAction.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    await flush();
    expect(screen.getByRole("alert").textContent).toMatch(/connection/i);
    expect((screen.getByRole("button", { name: /Done/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("unified timeline", () => {
  const activity = { id: "a1", prospect_id: "p", type: "note", title: "Called the owner", description: null, occurred_on: "2026-11-01", occurred_at: "2026-11-01T09:00:00Z", metadata: {}, created_at: "2026-11-01T09:00:00Z" } as never;

  it("merges activities, mail, quote events and preview views, newest first, each once", () => {
    const items = mergeTimeline(
      [activity],
      [{ id: "m1", direction: "incoming", from_address: "a@b.c", subject: "Re: concept", snippet: "Thanks", sent_at: "2026-11-02T08:00:00Z" }],
      [{ id: "q1", quoteId: "q", quoteNumber: "Q-2026-0001", type: "sent", title: "Marked as sent", createdAt: "2026-11-01T12:00:00Z" }],
      [{ id: "first", at: "2026-11-01T18:00:00Z", title: "Preview first viewed", detail: null }],
    );
    expect(items.map((i) => i.key)).toEqual(["m:m1", "p:first", "q:q1", "a:a1"]);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  it("renders every kind with a label for assistive tech and links quote events to the CRM", () => {
    const items = mergeTimeline(
      [activity],
      [{ id: "m1", direction: "outgoing", from_address: "me@x.y", subject: "Concept", snippet: null, sent_at: "2026-11-02T08:00:00Z" }],
      [{ id: "q1", quoteId: "q9", quoteNumber: "Q-2026-0001", type: "sent", title: "Marked as sent", createdAt: "2026-11-01T12:00:00Z" }],
      [{ id: "last", at: "2026-11-01T18:00:00Z", title: "Preview viewed again", detail: "3 visits in total" }],
    );
    render(<Timeline items={items} paths={crmPaths} />);
    expect(screen.getByRole("list", { name: "Activity timeline" })).toBeTruthy();
    expect(screen.getByText("Email sent")).toBeTruthy();
    expect(screen.getByText("Preview viewed again")).toBeTruthy();
    expect(screen.getByText("Called the owner")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Q-2026-0001" }).getAttribute("href")).toBe("/quotes/q9");
  });
});
