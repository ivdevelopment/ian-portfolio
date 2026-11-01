import { describe, expect, it } from "vitest";
import { isNavigationClick } from "@/components/ui/navigation-progress";
import { fileNameFromDisposition } from "@/components/admin/quote-pdf-buttons";
import { pendingLabel } from "@/lib/pending-label";
import { createSingleFlight } from "@/lib/single-flight";

describe("pendingLabel", () => {
  it("turns an action label into what is happening", () => {
    expect(pendingLabel("Save changes")).toBe("Saving changes…");
    expect(pendingLabel("Create quote")).toBe("Creating quote…");
    expect(pendingLabel("Delete draft")).toBe("Deleting draft…");
    expect(pendingLabel("Mark sent")).toBe("Marking sent…");
    expect(pendingLabel("Duplicate")).toBe("Duplicating…");
    expect(pendingLabel("Sync now")).toBe("Syncing now…");
    expect(pendingLabel("Download")).toBe("Downloading…");
    expect(pendingLabel("Save Dutch services")).toBe("Saving Dutch services…");
  });

  it("is case-insensitive and ignores a trailing ellipsis", () => {
    expect(pendingLabel("DELETE project")).toBe("Deleting project…");
    expect(pendingLabel("Save…")).toBe("Saving…");
  });

  it("never falls back to a bare 'Loading…'", () => {
    expect(pendingLabel("Frobnicate")).toBe("Working…");
    expect(pendingLabel("")).toBe("Working…");
  });
});

describe("createSingleFlight (duplicate submit prevention)", () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it("runs one job at a time and ignores calls while it is in flight", async () => {
    const flight = createSingleFlight();
    const d = deferred<string>();
    let calls = 0;
    const first = flight.run(() => {
      calls++;
      return d.promise;
    });
    expect(flight.busy).toBe(true);
    // A second click, a double submit, a repeated status transition: all ignored.
    expect(await flight.run(async () => (calls++, "second"))).toBeUndefined();
    expect(await flight.run(async () => (calls++, "third"))).toBeUndefined();
    d.resolve("done");
    expect(await first).toBe("done");
    expect(calls).toBe(1);
    expect(flight.busy).toBe(false);
  });

  it("is usable again after success", async () => {
    const flight = createSingleFlight();
    expect(await flight.run(async () => 1)).toBe(1);
    expect(await flight.run(async () => 2)).toBe(2);
  });

  it("always releases, also when the job fails (no permanently disabled button)", async () => {
    const flight = createSingleFlight();
    await expect(flight.run(async () => Promise.reject(new Error("network down")))).rejects.toThrow("network down");
    expect(flight.busy).toBe(false);
    expect(await flight.run(async () => "recovered")).toBe("recovered");
  });

  it("reports busy transitions so a UI can mirror them", async () => {
    const flight = createSingleFlight();
    const seen: boolean[] = [];
    await flight.run(async () => 1, (b) => seen.push(b));
    await flight.run(async () => Promise.reject(new Error("x")), (b) => seen.push(b)).catch(() => undefined);
    expect(seen).toEqual([true, false, true, false]);
  });
});

describe("isNavigationClick (when the progress bar starts)", () => {
  const here = { origin: "https://ianverlinden.com", pathname: "/admin/quotes", search: "" };
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it("starts for an internal link to another page", () => {
    expect(isNavigationClick({ href: "https://ianverlinden.com/admin/prospects" }, plain, here)).toBe(true);
    expect(isNavigationClick({ href: "/admin/prospects" }, plain, here)).toBe(true);
    expect(isNavigationClick({ href: "/admin/quotes?status=sent" }, plain, here)).toBe(true);
  });

  it("does not start for in-page anchors or the page you are already on", () => {
    expect(isNavigationClick({ href: "https://ianverlinden.com/admin/quotes#lines" }, plain, here)).toBe(false);
    expect(isNavigationClick({ href: "/admin/quotes" }, plain, here)).toBe(false);
    expect(isNavigationClick({ href: "#main" }, plain, here)).toBe(false);
  });

  it("does not start for new tabs, downloads, modifier clicks, other origins or non-http links", () => {
    expect(isNavigationClick({ href: "/admin/prospects", target: "_blank" }, plain, here)).toBe(false);
    expect(isNavigationClick({ href: "/admin/quotes/1/pdf", hasDownload: true }, plain, here)).toBe(false);
    expect(isNavigationClick({ href: "/admin/prospects" }, { ...plain, metaKey: true }, here)).toBe(false);
    expect(isNavigationClick({ href: "/admin/prospects" }, { ...plain, ctrlKey: true }, here)).toBe(false);
    expect(isNavigationClick({ href: "/admin/prospects" }, { ...plain, shiftKey: true }, here)).toBe(false);
    expect(isNavigationClick({ href: "/admin/prospects" }, { ...plain, button: 1 }, here)).toBe(false);
    expect(isNavigationClick({ href: "https://example.com/" }, plain, here)).toBe(false);
    expect(isNavigationClick({ href: "mailto:hello@ianverlinden.com" }, plain, here)).toBe(false);
    expect(isNavigationClick({ href: "tel:+32123" }, plain, here)).toBe(false);
    expect(isNavigationClick({ href: "javascript:void(0)" }, plain, here)).toBe(false);
  });

  it("treats target=_self as a normal navigation", () => {
    expect(isNavigationClick({ href: "/admin/prospects", target: "_self" }, plain, here)).toBe(true);
  });
});

describe("fileNameFromDisposition", () => {
  it("reads the file name the server chose and refuses path tricks", () => {
    expect(fileNameFromDisposition('attachment; filename="Q-2026-0004-geert-kips.pdf"', "quote.pdf")).toBe("Q-2026-0004-geert-kips.pdf");
    expect(fileNameFromDisposition(null, "quote.pdf")).toBe("quote.pdf");
    expect(fileNameFromDisposition('attachment; filename="../../evil.pdf"', "quote.pdf")).toBe("quote.pdf");
  });
});
