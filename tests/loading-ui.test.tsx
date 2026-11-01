// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(),
}));

const zoho = vi.hoisted(() => ({ zohoDryRunAction: vi.fn(), zohoSyncNowAction: vi.fn(), zohoDisconnectAction: vi.fn() }));
vi.mock("@/app/(admin)/admin/(panel)/settings/integrations/actions", () => zoho);

const quotes = vi.hoisted(() => ({
  changeQuoteStatusAction: vi.fn(),
  createProjectFromQuoteAction: vi.fn(),
  deleteQuoteAction: vi.fn(),
  duplicateQuoteAction: vi.fn(),
  extendValidityAction: vi.fn(),
  setProspectQuoteValueAction: vi.fn(),
}));
vi.mock("@/app/(admin)/admin/(panel)/quotes/actions", () => quotes);
vi.mock("@/app/(admin)/admin/(panel)/prospects/actions", () => ({ setStatusAction: vi.fn() }));

const reviews = vi.hoisted(() => ({ deleteReviewAction: vi.fn(), setReviewFeaturedAction: vi.fn(), setReviewStatusAction: vi.fn() }));
vi.mock("@/app/(admin)/admin/(panel)/reviews/actions", () => reviews);

import { ReviewRowActions } from "@/components/admin/review-row-actions";
import { QuoteDetailActions } from "@/components/admin/quote-detail-actions";
import { QuotePdfButtons } from "@/components/admin/quote-pdf-buttons";
import { SaveBar } from "@/components/admin/form-bits";
import { IconButton } from "@/components/admin/icon-button";
import { ZohoPanel } from "@/components/admin/zoho-panel";
import { Button } from "@/components/ui/button";
import { PageLoading, Skeleton, Spinner } from "@/components/ui/loading";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => act(async () => {});

beforeAll(() => {
  // jsdom has no <dialog> modal support.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("Button pending state", () => {
  it("is disabled, busy, and shows the action-specific text while pending", () => {
    render(
      <Button pending pendingLabel="Saving…">
        Save changes
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("is a normal enabled button when not pending, and keeps the idle label as its name", () => {
    render(
      <Button pending={false} pendingLabel="Saving…">
        Save changes
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBeNull();
  });

  it("does not call onClick while pending", () => {
    const onClick = vi.fn();
    render(
      <Button pending pendingLabel="Saving…" onClick={onClick}>
        Save
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("stays disabled when disabled for another reason, even after pending ends", () => {
    render(
      <Button disabled pendingLabel="Saving…">
        Save
      </Button>,
    );
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("an icon button swaps its icon for a spinner and is busy", () => {
    render(
      <IconButton busy aria-label="Duplicate project">
        <svg data-testid="icon" />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Duplicate project" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId("icon")).toBeNull();
  });
});

describe("shared loading primitives", () => {
  it("the spinner is decorative unless it has a label, and stops under reduced motion", () => {
    const { container } = render(<Spinner />);
    const el = container.firstElementChild!;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("motion-reduce:animate-none");
    cleanup();
    render(<Spinner label="Saving" />);
    expect(screen.getByRole("status").textContent).toBe("Saving");
  });

  it("a page loading region is announced once as busy; skeleton blocks are hidden from assistive tech", () => {
    const { container } = render(
      <PageLoading label="quotes">
        <Skeleton className="h-4" />
      </PageLoading>,
    );
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.textContent).toBe("Loading quotes…");
    expect(container.querySelector('[aria-hidden="true"]')?.className).toContain("motion-reduce:animate-none");
  });
});

describe("SaveBar", () => {
  it("is disabled while the form is clean and enabled when dirty", () => {
    const { rerender } = render(<SaveBar status={{ kind: "idle" }} dirty={false} label="Save changes" onSave={() => {}} />);
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<SaveBar status={{ kind: "idle" }} dirty label="Save changes" onSave={() => {}} />);
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says what is being saved while saving, and the button cannot be clicked", () => {
    const onSave = vi.fn();
    render(<SaveBar status={{ kind: "saving" }} dirty label="Create quote" onSave={onSave} />);
    const button = screen.getByRole("button", { name: "Creating quote…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("recovers after a failure: the error is shown and the button is usable again", () => {
    render(<SaveBar status={{ kind: "error", message: "Could not save." }} dirty label="Save changes" onSave={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("Could not save.");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Zoho sync", () => {
  const connection = { account: "me@example.test", lastSync: null, needsReconnect: false };
  const panel = () => render(<ZohoPanel connection={connection} lastRun={null} />);
  const emptyReport = { mode: "sync" as const, checked: 0, unique: 0, incoming: 0, outgoing: 0, matched: 0, unmatched: 0, ambiguous: 0, duplicateIds: 0, alreadyStored: 0, stored: 0, rateLimitRetries: 0, skippedUnusable: 0, errors: [], outgoingByFolder: {}, watched: [], pages: [] };

  it("shows 'Syncing…', disables everything, ignores a second click, then returns to normal", async () => {
    const pending = deferred<{ ok: true; report: typeof emptyReport }>();
    zoho.zohoSyncNowAction.mockReturnValue(pending.promise);
    panel();

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await flush();

    const syncing = screen.getByRole("button", { name: "Syncing…" }) as HTMLButtonElement;
    expect(syncing.disabled).toBe(true);
    expect(syncing.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Check mailbox (dry run)" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Disconnect" }) as HTMLButtonElement).disabled).toBe(true);
    // The connection stays visible and the status line explains the wait.
    expect(screen.getByRole("status").textContent).toContain("Syncing Zoho Mail");
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();

    fireEvent.click(syncing);
    fireEvent.click(syncing);
    await flush();
    expect(zoho.zohoSyncNowAction).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ ok: true, report: emptyReport }));
    expect((screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Sync finished")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the server's message when the sync fails and re-enables the button", async () => {
    zoho.zohoSyncNowAction.mockResolvedValue({ ok: false, error: "Zoho refused the credentials." });
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("Zoho refused the credentials.");
    expect((screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("recovers from a network failure (a thrown error) instead of staying disabled", async () => {
    zoho.zohoSyncNowAction.mockRejectedValue(new Error("fetch failed"));
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("could not be completed");
    const button = screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBeNull();
  });

  it("the dry run has its own label and blocks Sync now while it runs", async () => {
    const pending = deferred<{ ok: true }>();
    zoho.zohoDryRunAction.mockReturnValue(pending.promise);
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Check mailbox (dry run)" }));
    await flush();
    expect(screen.getByRole("button", { name: "Checking mailbox…" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => pending.resolve({ ok: true }));
  });
});

describe("Quote status actions", () => {
  const props = { id: "q1", number: "Q-2026-0001", status: "draft" as const, validUntil: "2026-12-01", prospect: null, netCents: 10000, currency: "EUR", language: "nl" as const, projectId: null, issues: [] };
  const open = () => render(<QuoteDetailActions {...props} />);
  const dialog = () => document.querySelector("dialog[open]") as HTMLElement;

  it("shows 'Marking as ready…', ignores repeated clicks, and fires the transition once", async () => {
    const pending = deferred<{ ok: true }>();
    quotes.changeQuoteStatusAction.mockReturnValue(pending.promise);
    open();

    fireEvent.click(screen.getByRole("button", { name: "Mark ready" }));
    await flush();
    const confirm = within(dialog()).getByRole("button", { name: "Mark ready" });
    fireEvent.click(confirm);
    await flush();

    const busy = within(dialog()).getByRole("button", { name: "Marking as ready…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    fireEvent.click(busy);
    expect(quotes.changeQuoteStatusAction).toHaveBeenCalledTimes(1);
    expect(quotes.changeQuoteStatusAction).toHaveBeenCalledWith("q1", { to: "ready" });
    // The other actions on the quote are locked while it runs: no accidental second transition.
    expect((screen.getByRole("button", { name: "Cancel quote" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Duplicate" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => pending.resolve({ ok: true }));
    expect(refresh).toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Duplicate" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the dialog open with the error and a usable button when the server refuses", async () => {
    quotes.changeQuoteStatusAction.mockResolvedValue({ ok: false, error: "Add at least one line item." });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Mark ready" }));
    await flush();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Mark ready" }));
    await flush();
    expect(within(dialog()).getByRole("alert").textContent).toContain("Add at least one line item.");
    expect((within(dialog()).getByRole("button", { name: "Mark ready" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("recovers from a thrown network error", async () => {
    quotes.changeQuoteStatusAction.mockRejectedValue(new Error("offline"));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Mark ready" }));
    await flush();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Mark ready" }));
    await flush();
    expect(within(dialog()).getByRole("alert").textContent).toMatch(/connection/i);
    expect((within(dialog()).getByRole("button", { name: "Mark ready" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("duplicating shows 'Duplicating…' on its own button and runs once", async () => {
    const pending = deferred<{ ok: true; id: string }>();
    quotes.duplicateQuoteAction.mockReturnValue(pending.promise);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await flush();
    const busy = screen.getByRole("button", { name: "Duplicating…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(quotes.duplicateQuoteAction).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: true, id: "q2" }));
  });

  it("deleting a draft says 'Deleting draft…'", async () => {
    const pending = deferred<{ ok: true }>();
    quotes.deleteQuoteAction.mockReturnValue(pending.promise);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    await flush();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Delete draft" }));
    await flush();
    expect(within(dialog()).getByRole("button", { name: "Deleting draft…" })).toBeTruthy();
    await act(async () => pending.resolve({ ok: true }));
  });
});

describe("Quote PDF download", () => {
  const pdf = () => new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), { status: 200, headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="Q-2026-0001-geert-kips.pdf"' } });

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
  });

  it("shows 'Generating PDF…' while the server builds it, downloads once, then restores the button", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<QuotePdfButtons id="q1" />);

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await flush();
    const busy = screen.getByRole("button", { name: "Generating PDF…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Preview PDF" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/admin/quotes/q1/pdf?download=1", { credentials: "same-origin" });

    await act(async () => pending.resolve(pdf()));
    expect((screen.getByRole("button", { name: "Download PDF" }) as HTMLButtonElement).disabled).toBe(false);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("shows an error and restores the button when generation fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    render(<QuotePdfButtons id="q1" />);
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("could not be generated");
    expect((screen.getByRole("button", { name: "Download PDF" }) as HTMLButtonElement).disabled).toBe(false);
    vi.unstubAllGlobals();
  });

  it("recovers from a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<QuotePdfButtons id="q1" />);
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("connection");
    expect((screen.getByRole("button", { name: "Download PDF" }) as HTMLButtonElement).disabled).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("row actions (review moderation)", () => {
  const review = { id: "r1", name: "Anna", status: "pending" as const, featured: false };

  it("only the clicked action shows its verb; the rest of the row is locked; a repeat click does nothing", async () => {
    const pending = deferred<{ ok: true }>();
    reviews.setReviewStatusAction.mockReturnValue(pending.promise);
    render(<ReviewRowActions review={review} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await flush();
    const busy = screen.getByRole("button", { name: "Approving…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(busy);
    expect(reviews.setReviewStatusAction).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ ok: true }));
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a thrown network error ends the pending state and is reported", async () => {
    reviews.setReviewStatusAction.mockRejectedValue(new Error("offline"));
    render(<ReviewRowActions review={review} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toMatch(/connection/i);
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a validation error from the server is shown and the row is usable again", async () => {
    reviews.setReviewStatusAction.mockResolvedValue({ ok: false, error: "Review not found." });
    render(<ReviewRowActions review={review} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("Review not found.");
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
