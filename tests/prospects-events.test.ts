import { describe, expect, it } from "vitest";
import { activityHeading, followUpDoneActivity, followUpSetActivity, projectDraftFromProspect, quickActionPatch } from "@/lib/prospects/events";

const TODAY = "2026-11-02";

describe("quick actions", () => {
  it("'Mark contacted' sets the status and today's contact date, and the first contact only once", () => {
    const first = quickActionPatch("mark_contacted", { status: "ready_to_contact", first_contact_on: null, last_contact_on: null }, TODAY);
    expect(first.patch).toEqual({ status: "contacted", last_contact_on: TODAY, first_contact_on: TODAY });
    // The database records the status change itself, so no duplicate activity is written here.
    expect(first.activity).toBeNull();

    const later = quickActionPatch("mark_contacted", { status: "replied", first_contact_on: "2026-10-30", last_contact_on: "2026-10-31" }, TODAY);
    expect(later.patch).toEqual({ status: "contacted", last_contact_on: TODAY });
  });

  it("logs an event when the click is a real repeat (status already the target)", () => {
    const again = quickActionPatch("mark_contacted", { status: "contacted", first_contact_on: "2026-10-30", last_contact_on: "2026-10-30" }, TODAY);
    expect(again.activity).toEqual({ type: "contacted", title: "Contact logged", occurred_on: TODAY });
    const reply = quickActionPatch("reply_received", { status: "replied", first_contact_on: "2026-10-30", last_contact_on: "2026-10-31" }, TODAY);
    expect(reply.activity).toMatchObject({ type: "reply_received", occurred_on: TODAY });
  });

  it("'Reply received', 'Mark won' and 'Mark lost' change only what they should", () => {
    expect(quickActionPatch("reply_received", { status: "contacted", first_contact_on: "2026-10-30", last_contact_on: null }, TODAY).patch).toEqual({ status: "replied", last_contact_on: TODAY });
    expect(quickActionPatch("mark_won", { status: "quote_sent", first_contact_on: null, last_contact_on: null }, TODAY).patch).toEqual({ status: "won" });
    expect(quickActionPatch("mark_lost", { status: "contacted", first_contact_on: null, last_contact_on: null }, TODAY).patch).toEqual({ status: "lost" });
  });
});

describe("follow-up events", () => {
  it("records scheduling, rescheduling and clearing; nothing when unchanged", () => {
    expect(followUpSetActivity("2026-11-09", null, TODAY)).toMatchObject({ type: "follow_up_set", title: "Follow-up scheduled", occurred_on: TODAY });
    expect(followUpSetActivity("2026-11-09", "2026-11-05", TODAY)?.title).toBe("Follow-up rescheduled");
    expect(followUpSetActivity(null, "2026-11-05", TODAY)?.title).toBe("Follow-up cleared");
    expect(followUpSetActivity("2026-11-05", "2026-11-05", TODAY)).toBeNull();
    expect(followUpSetActivity(null, null, TODAY)).toBeNull();
  });
  it("records completion as its own event", () => {
    expect(followUpDoneActivity(TODAY)).toEqual({ type: "follow_up_done", title: "Follow-up completed", occurred_on: TODAY });
  });
});

describe("timeline headings", () => {
  it("renders status changes from their metadata and other events as stored", () => {
    expect(activityHeading({ type: "status_changed", title: "Status changed", metadata: { from: "contacted", to: "replied" } })).toEqual({ title: "Status: Replied", detail: "From Contacted" });
    expect(activityHeading({ type: "note", title: "Called the owner", metadata: {} })).toEqual({ title: "Called the owner", detail: null });
    expect(activityHeading({ type: "status_changed", title: "Status changed", metadata: {} })).toEqual({ title: "Status changed", detail: null });
  });
});

describe("convert to project", () => {
  it("builds an UNPUBLISHED draft from facts the prospect holds, with a unique slug", () => {
    const draft = projectDraftFromProspect({ company_name: "Geert Kips", sector: "Bouw", website_url: "geertkips.be" }, ["geert-kips"]);
    expect(draft).toMatchObject({
      slug: "geert-kips-2",
      title: "Geert Kips",
      client: "Geert Kips",
      category: "Bouw",
      live_url: "https://geertkips.be",
      published: false,
      featured: false,
    });
  });
  it("does not invent content: placeholders are marked, missing facts stay empty", () => {
    const draft = projectDraftFromProspect({ company_name: "Vault One", sector: null, website_url: null }, []);
    expect(draft.live_url).toBeNull();
    expect(draft.category).toBe("Website");
    expect(draft.short_description).toMatch(/^Draft created from a prospect/);
    expect(draft.published).toBe(false);
  });
});
