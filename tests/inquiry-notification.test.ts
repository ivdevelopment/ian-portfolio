import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => ({ rpc: vi.fn() }) }));

import { buildInquiryEmail, escapeHtml, headerSafe, sendInquiryNotification } from "@/lib/email/inquiry-notification";
import { loadSmtpConfig } from "@/lib/email/mailer";
import { processInquiry } from "@/lib/inquiry-submit";

const env = {
  ZOHO_SMTP_USER: "hello@ianverlinden.com",
  ZOHO_SMTP_PASSWORD: "super-secret-password",
  CONTACT_NOTIFICATION_EMAIL: "hello@ianverlinden.com",
  NEXT_PUBLIC_SITE_URL: "https://ianverlinden.com",
};
const valid = {
  name: "John Doe",
  email: "john@example.com",
  projectType: "New website",
  budget: "€1,000 – €2,500",
  message: "I'd like a website for my small business, please get in touch.",
  company: "",
};
const ok = () => vi.fn(async () => ({ data: "ok", error: null }));
const passes = vi.fn(async () => "ok" as const);

describe("notification flow in processInquiry", () => {
  it("notifies once, after the inquiry is stored, and answers success", async () => {
    const order: string[] = [];
    const rpc = vi.fn(async () => (order.push("db"), { data: "ok", error: null }));
    const notify = vi.fn(async () => void order.push("mail"));
    expect(await processInquiry(valid, 9000, "t", "1.1.1.1", "nl", { rpc, verify: passes, notify })).toEqual({ status: "sent" });
    expect(order).toEqual(["db", "mail"]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ email: "john@example.com", projectType: "New website" }));
  });

  it("does not notify when validation fails", async () => {
    const notify = vi.fn();
    const r = await processInquiry({ ...valid, email: "nope" }, 9000, "t", "ip", "nl", { rpc: ok(), verify: passes, notify });
    expect(r.status).toBe("invalid");
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify when the security check fails", async () => {
    const notify = vi.fn();
    const r = await processInquiry(valid, 9000, "t", "ip", "nl", { rpc: ok(), verify: async () => "failed", notify });
    expect(r.status).toBe("error");
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify when persistence fails or is rate limited", async () => {
    const notify = vi.fn();
    const failed = await processInquiry(valid, 9000, "t", "ip", "nl", { rpc: async () => ({ data: null, error: { code: "XX" } }), verify: passes, notify });
    const limited = await processInquiry(valid, 9000, "t", "ip", "nl", { rpc: async () => ({ data: "rate_limited", error: null }), verify: passes, notify });
    expect(failed.status).toBe("error");
    expect(limited.status).toBe("error");
    expect(notify).not.toHaveBeenCalled();
  });

  it("still reports success when the notification step blows up", async () => {
    const notify = vi.fn(async () => {
      throw new Error("smtp down");
    });
    expect(await processInquiry(valid, 9000, "t", "ip", "nl", { rpc: ok(), verify: passes, notify })).toEqual({ status: "sent" });
  });
});

describe("sendInquiryNotification", () => {
  it("sends one message through the injected transport", async () => {
    const sendMail = vi.fn(async () => ({}));
    expect(await sendInquiryNotification(valid, { transport: { sendMail }, env })).toBe("sent");
    expect(sendMail).toHaveBeenCalledOnce();
  });

  it("swallows transport failures, logging only a code and never secrets", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sendMail = vi.fn(async () => {
      throw Object.assign(new Error("535 auth failed for super-secret-password"), { code: "EAUTH" });
    });
    expect(await sendInquiryNotification(valid, { transport: { sendMail }, env })).toBe("failed");
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("EAUTH");
    expect(logged).not.toContain("super-secret-password");
    spy.mockRestore();
  });

  it("is disabled (not an error) without SMTP configuration", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await sendInquiryNotification(valid, { transport: null, env: {} })).toBe("disabled");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(loadSmtpConfig({})).toBeNull();
    expect(loadSmtpConfig({ ZOHO_SMTP_USER: "a@b.c" })).toBeNull();
  });
});

describe("email content", () => {
  const msg = buildInquiryEmail(valid, {
    from: "hello@ianverlinden.com",
    to: "hello@ianverlinden.com",
    siteUrl: "https://ianverlinden.com/",
    submittedAt: new Date("2026-10-30T10:00:00Z"),
  });

  it("is sent from the authenticated mailbox with Reply-To set to the lead", () => {
    expect(msg.from).toEqual({ name: "Ian Verlinden Website", address: "hello@ianverlinden.com" });
    expect(msg.replyTo?.address).toBe("john@example.com");
    expect(msg.from.address).not.toBe(valid.email);
    expect(msg.subject).toBe("Nieuwe projectaanvraag — Nieuwe website");
  });

  it("has readable text and HTML with every field and the admin link", () => {
    for (const body of [msg.text, msg.html]) {
      expect(body).toContain("John Doe");
      expect(body).toContain("john@example.com");
      expect(body).toContain("Nieuwe website");
      expect(body).toContain("€ 1.000 – € 2.500");
      expect(body).toContain("https://ianverlinden.com/admin/inquiries");
    }
    expect(msg.text).toContain("Bericht:\nI'd like a website");
  });

  it("escapes visitor HTML in the HTML body and keeps it literal in text", () => {
    const evil = buildInquiryEmail(
      { ...valid, name: '<img src=x onerror=alert(1)>', message: "<b>test</b> <script>alert(1)</script>" },
      { from: "a@b.c", to: "a@b.c", siteUrl: "https://x.y", submittedAt: new Date() },
    );
    expect(evil.html).not.toMatch(/<script|<b>test|<img/);
    expect(evil.html).toContain("&lt;b&gt;test&lt;/b&gt;");
    expect(evil.text).toContain("<b>test</b>");
  });

  it("cannot inject headers through names or subjects", () => {
    expect(headerSafe("Bob\r\nBcc: evil@x.com")).not.toMatch(/[\r\n]/);
    const m = buildInquiryEmail({ ...valid, name: "Bob\r\nBcc: evil@x.com", projectType: "Other\r\nX: y" }, {
      from: "a@b.c", to: "a@b.c", siteUrl: "https://x.y", submittedAt: new Date(),
    });
    expect(m.replyTo?.name).not.toMatch(/[\r\n]/);
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(escapeHtml(`"'&<>`)).toBe("&quot;&#39;&amp;&lt;&gt;");
  });
});

describe("secrets stay server-side", () => {
  it("never appear in the response returned to the visitor", async () => {
    const notify = vi.fn(async () => {
      throw new Error(env.ZOHO_SMTP_PASSWORD);
    });
    const result = await processInquiry(valid, 9000, "t", "ip", "nl", { rpc: ok(), verify: passes, notify });
    expect(JSON.stringify(result)).not.toContain(env.ZOHO_SMTP_PASSWORD);
  });

  it("the SMTP password is not a NEXT_PUBLIC variable", () => {
    expect(Object.keys(env).filter((k) => k.startsWith("NEXT_PUBLIC_") && /PASSWORD|SECRET/.test(k))).toEqual([]);
  });
});
