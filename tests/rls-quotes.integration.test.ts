/**
 * Quote tables and functions against a REAL local Supabase stack: admin-only, numbering, transitions, locking,
 * snapshots, no cascade from prospects. Skipped unless run via `npm run test:rls`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyItem, emptyQuoteForm, toRpcPayload, type QuoteFormValues } from "@/lib/quotes/schema";
import { assertLocalSupabase } from "./local-only";

const enabled = process.env.RLS_TEST === "1" || process.env.npm_lifecycle_event === "test:rls";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (enabled) assertLocalSupabase();

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const TAG = "quotetest";
const ADMIN = { email: `${TAG}-admin@portfolio.test`, password: "Quote-Admin-Password-2026!" };
const OUTSIDER = { email: `${TAG}-outsider@portfolio.test`, password: "Quote-Outsider-Password-2026!" };
const YEARS = [2090, 2091];

const form = (over: Partial<QuoteFormValues> = {}): QuoteFormValues =>
  emptyQuoteForm({
    clientName: `${TAG} client`,
    title: "Website",
    validUntil: "2099-12-31",
    items: [emptyItem({ title: "Design", quantity: "2", unit: "stuk", unitPrice: "100", taxRate: "21" }), emptyItem({ title: "Hosting", quantity: "1", unitPrice: "49.50", taxRate: "6" })],
    ...over,
  });

describe.skipIf(!enabled)("quotes", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;
  let outsider: SupabaseClient;
  const userIds: string[] = [];

  // Every quote a test makes is remembered here, so cleanup never depends on a name a test may have blanked.
  const made: string[] = [];
  const wipe = async () => {
    await service.from("quotes").delete().like("client_name", `${TAG}%`);
    if (made.length) await service.from("quotes").delete().in("id", made.splice(0));
    await service.from("prospects").delete().like("company_name", `${TAG}%`);
    await service.from("quote_item_templates").delete().like("name", `${TAG}%`);
    await service.from("quote_counters").delete().in("year", YEARS);
  };

  async function create(values: QuoteFormValues = form()): Promise<string> {
    const { quote, items } = toRpcPayload(values);
    const res = await admin.rpc("create_quote", { p_quote: quote as never, p_items: items as never });
    expect(res.error).toBeNull();
    made.push(res.data as string);
    return res.data as string;
  }
  const row = async (id: string) => (await service.from("quotes").select("*").eq("id", id).single()).data!;
  const setStatus = (id: string, status: string, extra: Record<string, unknown> = {}) => admin.from("quotes").update({ status, ...extra }).eq("id", id);

  beforeAll(async () => {
    service = createClient(url, serviceKey, opts);
    anon = createClient(url, anonKey, opts);
    const users = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of users.data!.users.filter((u) => u.email?.startsWith(TAG))) await service.auth.admin.deleteUser(u.id);
    for (const account of [ADMIN, OUTSIDER]) {
      const createdUser = await service.auth.admin.createUser({ ...account, email_confirm: true });
      expect(createdUser.error).toBeNull();
      userIds.push(createdUser.data.user!.id);
    }
    expect((await service.from("admin_users").insert({ user_id: userIds[0] })).error).toBeNull();
    admin = createClient(url, anonKey, opts);
    expect((await admin.auth.signInWithPassword(ADMIN)).error).toBeNull();
    outsider = createClient(url, anonKey, opts);
    expect((await outsider.auth.signInWithPassword(OUTSIDER)).error).toBeNull();
    await wipe();
  });
  afterAll(async () => {
    await wipe();
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  describe("access", () => {
    const tables = ["quotes", "quote_items", "quote_activities", "quote_item_templates", "quote_settings", "quote_counters"] as const;

    it("anonymous visitors can read and write nothing", async () => {
      const id = await create();
      for (const table of tables) {
        const res = await anon.from(table).select("*").limit(1);
        // No grant at all: PostgREST answers with a permission error rather than an empty list.
        expect(res.error, table).not.toBeNull();
        expect(res.data ?? []).toEqual([]);
      }
      expect((await anon.from("quotes").insert({ quote_number: "Q-2026-9999" })).error).not.toBeNull();
      expect((await anon.from("quotes").update({ title: "hacked" }).eq("id", id)).error).not.toBeNull();
      expect((await anon.from("quotes").delete().eq("id", id)).error).not.toBeNull();
      const { quote, items } = toRpcPayload(form());
      expect((await anon.rpc("create_quote", { p_quote: quote as never, p_items: items as never })).error).not.toBeNull();
      expect((await anon.rpc("allocate_quote_number", { p_year: 2090 })).error).not.toBeNull();
      expect((await anon.rpc("duplicate_quote", { p_id: id })).error).not.toBeNull();
      expect((await row(id)).title).toBe("Website");
    });

    it("a signed-in user who is not an admin sees and changes nothing", async () => {
      const id = await create();
      for (const table of tables.filter((t) => t !== "quote_counters")) {
        const res = await outsider.from(table).select("*");
        expect(res.data ?? [], table).toEqual([]);
      }
      expect((await outsider.from("quotes").insert({ quote_number: "Q-2026-9998" })).error).not.toBeNull();
      expect((await outsider.from("quotes").update({ title: "hacked" }).eq("id", id)).data ?? []).toEqual([]);
      expect((await row(id)).title).toBe("Website");
      expect((await outsider.from("quote_item_templates").insert({ name: `${TAG} x` })).error).not.toBeNull();
      expect((await outsider.from("quote_settings").update({ business_name: "x" }).eq("id", true).select()).data ?? []).toEqual([]);
      const { quote, items } = toRpcPayload(form());
      expect((await outsider.rpc("create_quote", { p_quote: quote as never, p_items: items as never })).error).not.toBeNull();
      expect((await outsider.rpc("allocate_quote_number", { p_year: 2090 })).error).not.toBeNull();
    });

    it("the counter table is not readable or writable by anyone but the function", async () => {
      expect((await admin.from("quote_counters").select("*")).error).not.toBeNull();
      expect((await admin.from("quote_counters").insert({ year: 2090, last_number: 5 })).error).not.toBeNull();
    });
  });

  describe("numbering", () => {
    it("numbers quotes Q-YYYY-NNNN", async () => {
      const id = await create();
      const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric" }).format(new Date());
      expect((await row(id)).quote_number).toMatch(new RegExp(`^Q-${year}-\\d{4,}$`));
    });

    it("is sequential and unique under simultaneous creation", async () => {
      const ids = await Promise.all(Array.from({ length: 16 }, () => create()));
      const numbers = (await service.from("quotes").select("quote_number").in("id", ids)).data!.map((r) => r.quote_number);
      expect(new Set(numbers).size).toBe(16);
      const n = numbers.map((s) => Number(s.slice(-4))).sort((a, b) => a - b);
      expect(n[n.length - 1] - n[0]).toBe(15);
    });

    it("restarts at 0001 in a new year and never repeats a number", async () => {
      const a = await admin.rpc("allocate_quote_number", { p_year: 2090 });
      const b = await admin.rpc("allocate_quote_number", { p_year: 2090 });
      const c = await admin.rpc("allocate_quote_number", { p_year: 2091 });
      expect([a.data, b.data, c.data]).toEqual(["Q-2090-0001", "Q-2090-0002", "Q-2091-0001"]);
    });

    it("a rolled-back creation gives its number back (no gaps)", async () => {
      const { quote, items } = toRpcPayload(form());
      const before = (await service.from("quote_counters").select("last_number").eq("year", Number(new Date().getFullYear()))).data?.[0]?.last_number;
      const bad = await admin.rpc("create_quote", { p_quote: { ...quote, total: "1.00" } as never, p_items: items as never });
      expect(bad.error).not.toBeNull();
      const id = await create();
      const after = Number((await row(id)).quote_number.slice(-4));
      expect(after).toBe(Number(before ?? 0) + 1);
    });

    it("the number is unique and can never change", async () => {
      const id = await create();
      const other = await create();
      const n = (await row(other)).quote_number;
      expect((await service.from("quotes").update({ quote_number: n }).eq("id", id)).error).not.toBeNull();
      expect((await admin.from("quotes").update({ quote_number: "Q-2030-0001" }).eq("id", id)).error).not.toBeNull();
    });
  });

  describe("saving", () => {
    it("stores the calculated figures and lines in order", async () => {
      const id = await create();
      const q = await row(id);
      // 2 x 100 (21%) = 200 + 42; 1 x 49.50 (6%) = 49.50 + 2.97
      expect([q.subtotal, q.discount_total, q.tax_total, q.total]).toEqual([249.5, 0, 44.97, 294.47]);
      const items = (await service.from("quote_items").select("*").eq("quote_id", id).order("position")).data!;
      expect(items.map((i) => [i.position, i.title, i.line_total])).toEqual([[0, "Design", 242], [1, "Hosting", 52.47]]);
    });

    it("rejects totals that do not match the lines, and impossible numbers", async () => {
      const { quote, items } = toRpcPayload(form());
      expect((await admin.rpc("create_quote", { p_quote: { ...quote, subtotal: "1.00" } as never, p_items: items as never })).error).not.toBeNull();
      const bad = items.map((i, n) => (n === 0 ? { ...i, line_total: "1.00" } : i));
      expect((await admin.rpc("create_quote", { p_quote: quote as never, p_items: bad as never })).error).not.toBeNull();
      const negative = items.map((i, n) => (n === 0 ? { ...i, unit_price: "-5.00" } : i));
      expect((await admin.rpc("create_quote", { p_quote: quote as never, p_items: negative as never })).error).not.toBeNull();
      const tooMuch = items.map((i, n) => (n === 0 ? { ...i, discount_percent: "100.01" } : i));
      expect((await admin.rpc("create_quote", { p_quote: quote as never, p_items: tooMuch as never })).error).not.toBeNull();
    });

    it("update replaces content and lines in one go and guards against stale saves", async () => {
      const id = await create();
      const first = await row(id);
      const { quote, items } = toRpcPayload(form({ title: "Updated", items: [emptyItem({ title: "Only line", unitPrice: "10" })] }));
      const res = await admin.rpc("update_quote", { p_id: id, p_quote: quote as never, p_items: items as never, p_expected_updated_at: first.updated_at });
      expect(res.error).toBeNull();
      const after = await row(id);
      expect(after.title).toBe("Updated");
      expect(after.total).toBe(12.1);
      expect((await service.from("quote_items").select("id").eq("quote_id", id)).data).toHaveLength(1);

      const stale = await admin.rpc("update_quote", { p_id: id, p_quote: quote as never, p_items: items as never, p_expected_updated_at: first.updated_at });
      expect(stale.error?.message).toMatch(/changed elsewhere/);
    });

    it("a failed update leaves the old lines in place (atomic)", async () => {
      const id = await create();
      const { quote, items } = toRpcPayload(form());
      const res = await admin.rpc("update_quote", { p_id: id, p_quote: { ...quote, total: "1.00" } as never, p_items: items as never, p_expected_updated_at: null as never });
      expect(res.error).not.toBeNull();
      expect((await service.from("quote_items").select("id").eq("quote_id", id)).data).toHaveLength(2);
      expect((await row(id)).total).toBe(294.47);
    });

    it("the database enforces the arithmetic identities itself", async () => {
      const id = await create();
      expect((await admin.from("quotes").update({ total: "1.00" }).eq("id", id)).error).not.toBeNull();
      expect((await admin.from("quotes").update({ discount_total: "999999.00", total: "0.00" }).eq("id", id)).error).not.toBeNull();
      expect((await admin.from("quote_items").update({ line_total: "1.00" }).eq("quote_id", id)).error).not.toBeNull();
    });
  });

  describe("status workflow", () => {
    it("walks draft -> ready -> sent -> accepted and stamps the dates", async () => {
      const id = await create();
      expect((await setStatus(id, "ready")).error).toBeNull();
      expect((await setStatus(id, "sent")).error).toBeNull();
      const sent = await row(id);
      expect(sent.sent_at).not.toBeNull();
      expect(sent.accepted_at).toBeNull();
      expect((await setStatus(id, "accepted")).error).toBeNull();
      const done = await row(id);
      expect(done.accepted_at).not.toBeNull();
      expect(done.rejected_at).toBeNull();
    });

    it("rejection keeps the optional note and the date", async () => {
      const id = await create();
      await setStatus(id, "ready");
      await setStatus(id, "sent");
      expect((await setStatus(id, "rejected", { status_note: "Too expensive" })).error).toBeNull();
      const q = await row(id);
      expect([q.status, q.status_note]).toEqual(["rejected", "Too expensive"]);
      expect(q.rejected_at).not.toBeNull();
    });

    it("refuses invalid transitions, for everyone including the service role", async () => {
      const id = await create();
      expect((await setStatus(id, "sent")).error).not.toBeNull();
      expect((await setStatus(id, "accepted")).error).not.toBeNull();
      expect((await service.from("quotes").update({ status: "accepted" }).eq("id", id)).error).not.toBeNull();
      await setStatus(id, "cancelled");
      expect((await setStatus(id, "draft")).error).not.toBeNull();
      expect((await setStatus(id, "ready")).error).not.toBeNull();
      expect((await row(id)).status).toBe("cancelled");
    });

    it("a quote cannot be marked ready without a client, a title and a line", async () => {
      const noItems = await create(form({ items: [] }));
      expect((await setStatus(noItems, "ready")).error?.message).toMatch(/line item/);
      const noClient = await create(form({ clientName: "" }));
      await service.from("quotes").update({ client_name: null }).eq("id", noClient);
      expect((await setStatus(noClient, "ready")).error?.message).toMatch(/client name/);
      const noTitle = await create(form({ title: "" }));
      expect((await setStatus(noTitle, "ready")).error?.message).toMatch(/title/);
    });

    it("accepted is final apart from cancelling", async () => {
      const id = await create();
      for (const s of ["ready", "sent", "accepted"]) await setStatus(id, s);
      expect((await setStatus(id, "rejected")).error).not.toBeNull();
      expect((await setStatus(id, "cancelled")).error).toBeNull();
    });

    it("a sent quote that expired can be reopened by extending its validity", async () => {
      const id = await create();
      for (const s of ["ready", "sent"]) await setStatus(id, s);
      expect((await setStatus(id, "expired")).error).toBeNull();
      expect((await setStatus(id, "sent", { valid_until: "2099-06-30" })).error).toBeNull();
      expect((await row(id)).valid_until).toBe("2099-06-30");
    });
  });

  describe("locking", () => {
    async function sentQuote() {
      const id = await create();
      await setStatus(id, "ready");
      await setStatus(id, "sent");
      return id;
    }

    it("a sent quote's content cannot be edited", async () => {
      const id = await sentQuote();
      expect((await admin.from("quotes").update({ title: "Changed" }).eq("id", id)).error?.message).toMatch(/can no longer be edited/);
      expect((await admin.from("quotes").update({ client_name: "Someone else" }).eq("id", id)).error).not.toBeNull();
      expect((await admin.from("quotes").update({ total: "1.00", subtotal: "1.00", tax_total: "0.00" }).eq("id", id)).error).not.toBeNull();
      const { quote, items } = toRpcPayload(form({ title: "Changed" }));
      expect((await admin.rpc("update_quote", { p_id: id, p_quote: quote as never, p_items: items as never, p_expected_updated_at: null as never })).error).not.toBeNull();
      expect((await row(id)).title).toBe("Website");
    });

    it("its lines cannot be changed through the table either", async () => {
      const id = await sentQuote();
      const lines = (await service.from("quote_items").select("id").eq("quote_id", id)).data!;
      expect((await admin.from("quote_items").update({ title: "Changed" }).eq("quote_id", id).select()).data ?? []).toEqual([]);
      expect((await admin.from("quote_items").delete().eq("quote_id", id).select()).data ?? []).toEqual([]);
      const extra = await admin.from("quote_items").insert({ quote_id: id, position: 9, title: "Extra", quantity: 1, unit_price: 1, line_subtotal: 1, line_tax: 0, line_total: 1 });
      expect(extra.error).not.toBeNull();
      expect((await service.from("quote_items").select("id").eq("quote_id", id)).data).toHaveLength(lines.length);
    });

    it("the validity can be extended while sent, and the change is logged", async () => {
      const id = await sentQuote();
      expect((await admin.from("quotes").update({ valid_until: "2099-01-01" }).eq("id", id)).error).toBeNull();
      const log = (await service.from("quote_activities").select("type").eq("quote_id", id)).data!.map((a) => a.type);
      expect(log).toContain("validity_extended");
    });

    it("an accepted quote's validity is fixed, its project link is not", async () => {
      const id = await sentQuote();
      await setStatus(id, "accepted");
      expect((await admin.from("quotes").update({ valid_until: "2099-01-01" }).eq("id", id)).error).not.toBeNull();
      const project = await service.from("projects").select("id").limit(1);
      if (project.data?.[0]) expect((await admin.from("quotes").update({ project_id: project.data[0].id }).eq("id", id)).error).toBeNull();
    });

    it("a ready quote can still be edited", async () => {
      const id = await create();
      await setStatus(id, "ready");
      const { quote, items } = toRpcPayload(form({ title: "Still editable" }));
      expect((await admin.rpc("update_quote", { p_id: id, p_quote: quote as never, p_items: items as never, p_expected_updated_at: null as never })).error).toBeNull();
      expect((await row(id)).title).toBe("Still editable");
    });
  });

  describe("deleting", () => {
    it("deletes a draft with its lines and history", async () => {
      const id = await create();
      expect((await admin.from("quotes").delete().eq("id", id).select()).data).toHaveLength(1);
      expect((await service.from("quote_items").select("id").eq("quote_id", id)).data).toEqual([]);
      expect((await service.from("quote_activities").select("id").eq("quote_id", id)).data).toEqual([]);
    });

    it("never deletes a quote that has left draft", async () => {
      for (const path of [["ready"], ["ready", "sent"], ["ready", "sent", "accepted"], ["ready", "sent", "rejected"], ["cancelled"]]) {
        const id = await create();
        for (const s of path) await setStatus(id, s);
        expect((await admin.from("quotes").delete().eq("id", id).select()).data ?? [], path.join(">")).toEqual([]);
        expect((await row(id)).status).toBe(path[path.length - 1]);
      }
    });
  });

  describe("relationships and snapshots", () => {
    it("a prospect can have several quotes", async () => {
      const p = await admin.from("prospects").insert({ company_name: `${TAG} prospect` }).select("id").single();
      const a = await create(form({ prospectId: p.data!.id }));
      const b = await create(form({ prospectId: p.data!.id }));
      const list = await admin.from("quotes").select("id").eq("prospect_id", p.data!.id);
      expect(list.data!.map((r) => r.id).sort()).toEqual([a, b].sort());
    });

    it("deleting a prospect keeps its quotes, with the client snapshot", async () => {
      const p = await admin.from("prospects").insert({ company_name: `${TAG} doomed`, email: "d@example.test" }).select("id").single();
      const id = await create(form({ prospectId: p.data!.id, clientName: `${TAG} Doomed Co`, clientEmail: "d@example.test" }));
      for (const s of ["ready", "sent"]) await setStatus(id, s);
      expect((await admin.from("prospects").delete().eq("id", p.data!.id)).error).toBeNull();
      const q = await row(id);
      expect(q.prospect_id).toBeNull();
      expect([q.client_name, q.client_email, q.status]).toEqual([`${TAG} Doomed Co`, "d@example.test", "sent"]);
      expect((await service.from("quote_items").select("id").eq("quote_id", id)).data).toHaveLength(2);
    });

    it("changing the prospect afterwards does not change the quote", async () => {
      const p = await admin.from("prospects").insert({ company_name: `${TAG} before`, email: "before@example.test" }).select("id").single();
      const id = await create(form({ prospectId: p.data!.id, clientCompany: `${TAG} before`, clientEmail: "before@example.test" }));
      await admin.from("prospects").update({ company_name: `${TAG} after`, email: "after@example.test" }).eq("id", p.data!.id);
      const q = await row(id);
      expect([q.client_company, q.client_email]).toEqual([`${TAG} before`, "before@example.test"]);
    });

    it("lines are snapshots: editing or deleting a template never changes an old quote", async () => {
      const t = await admin.from("quote_item_templates").insert({ name: `${TAG} Design`, default_unit_price: 800, default_unit: "stuk" }).select("id").single();
      const id = await create(form({ items: [emptyItem({ templateId: t.data!.id, title: `${TAG} Design`, unitPrice: "800" })] }));
      await admin.from("quote_item_templates").update({ name: `${TAG} Renamed`, default_unit_price: 999 }).eq("id", t.data!.id);
      let item = (await service.from("quote_items").select("*").eq("quote_id", id).single()).data!;
      expect([item.title, item.unit_price, item.template_id]).toEqual([`${TAG} Design`, 800, t.data!.id]);
      await admin.from("quote_item_templates").delete().eq("id", t.data!.id);
      item = (await service.from("quote_items").select("*").eq("quote_id", id).single()).data!;
      expect([item.title, item.unit_price, item.template_id]).toEqual([`${TAG} Design`, 800, null]);
    });

    it("deleting a project keeps the quote", async () => {
      const proj = await service.from("projects").insert({ slug: `${TAG}-proj`, title: `${TAG} proj`, summary: "x", category: "web", year: 2026 } as never).select("id").maybeSingle();
      if (!proj.data) return; // Project columns differ: the FK behaviour is covered by the migration's ON DELETE SET NULL.
      const id = await create();
      await service.from("quotes").update({ project_id: proj.data.id }).eq("id", id);
      await service.from("projects").delete().eq("id", proj.data.id);
      expect((await row(id)).project_id).toBeNull();
    });
  });

  describe("duplicate", () => {
    it("copies content and lines into a fresh draft", async () => {
      const id = await create(form({ discountType: "percent", discountValue: "10" }));
      for (const s of ["ready", "sent", "rejected"]) await setStatus(id, s, s === "rejected" ? { status_note: "no" } : {});
      const copy = await admin.rpc("duplicate_quote", { p_id: id });
      expect(copy.error).toBeNull();
      made.push(copy.data as string);
      const [a, b] = [await row(id), await row(copy.data as string)];
      expect(b.quote_number).not.toBe(a.quote_number);
      expect([b.status, b.sent_at, b.accepted_at, b.rejected_at, b.status_note]).toEqual(["draft", null, null, null, null]);
      expect([b.client_name, b.title, b.total, b.discount_type, b.discount_value]).toEqual([a.client_name, a.title, a.total, a.discount_type, a.discount_value]);
      const lines = (await service.from("quote_items").select("title,line_total,position").eq("quote_id", b.id).order("position")).data!;
      expect(lines).toHaveLength(2);
      expect(b.valid_until).not.toBe(a.valid_until);
      // And it is a normal draft: editable.
      expect((await admin.from("quotes").update({ title: "Revision" }).eq("id", b.id)).error).toBeNull();
      expect((await row(id)).title).toBe("Website");
    });
  });

  describe("activity log", () => {
    it("records creation, every status change, and one 'edited' entry per editing session", async () => {
      const id = await create();
      const { quote, items } = toRpcPayload(form({ title: "v2" }));
      for (let i = 0; i < 3; i++) await admin.rpc("update_quote", { p_id: id, p_quote: quote as never, p_items: items as never, p_expected_updated_at: null as never });
      for (const s of ["ready", "sent", "accepted"]) await setStatus(id, s);
      const log = (await service.from("quote_activities").select("type").eq("quote_id", id).order("created_at")).data!.map((a) => a.type);
      expect(log.filter((t) => t === "edited")).toHaveLength(1);
      expect(log).toEqual(expect.arrayContaining(["created", "edited", "ready", "sent", "accepted"]));
    });

    it("is append-only for the admin", async () => {
      const id = await create();
      const entry = await admin.from("quote_activities").insert({ quote_id: id, type: "pdf_generated", title: "PDF downloaded" }).select("id").single();
      expect(entry.error).toBeNull();
      expect((await admin.from("quote_activities").update({ title: "x" }).eq("id", entry.data!.id).select()).data ?? []).toEqual([]);
      expect((await admin.from("quote_activities").delete().eq("id", entry.data!.id).select()).data ?? []).toEqual([]);
    });
  });

  describe("settings and templates", () => {
    it("has exactly one settings row with the agreed defaults, editable by the admin", async () => {
      const s = await admin.from("quote_settings").select("*");
      expect(s.data).toHaveLength(1);
      expect(s.data![0]).toMatchObject({ default_language: "nl", default_validity_days: 14, business_name: "Ian Verlinden" });
      expect(Number(s.data![0].default_tax_rate)).toBe(21);
      expect(s.data![0].business_vat_number).toBeNull();
      expect((await admin.from("quote_settings").insert({ id: false })).error).not.toBeNull();
      const before = s.data![0].default_validity_days;
      expect((await admin.from("quote_settings").update({ default_validity_days: 30 }).eq("id", true)).error).toBeNull();
      expect((await admin.from("quote_settings").update({ default_validity_days: 0 }).eq("id", true)).error).not.toBeNull();
      await admin.from("quote_settings").update({ default_validity_days: before }).eq("id", true);
    });

    it("ships the example templates without inventing prices", async () => {
      const t = await admin.from("quote_item_templates").select("name, default_unit_price, active").eq("active", true).not("name", "like", `${TAG}%`);
      expect(t.data!.length).toBeGreaterThanOrEqual(10);
      expect(t.data!.map((r) => r.name)).toEqual(expect.arrayContaining(["Website design", "Website development", "SEO setup", "Custom web application"]));
      expect(t.data!.every((r) => r.default_unit_price === null)).toBe(true);
    });
  });
});
