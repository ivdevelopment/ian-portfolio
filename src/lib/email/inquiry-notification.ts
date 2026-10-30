import "server-only";

import { getMailer, type MailMessage, type MailTransport } from "./mailer";

/** The already-validated inquiry (output of `inquirySchema`). */
export type NotifiableInquiry = {
  name: string;
  email: string;
  projectType: string;
  budget: string;
  message: string;
};

const SENDER_NAME = "Ian Verlinden Website";

/** Header-safe text: control characters (incl. CR/LF) and header-significant characters removed. */
export function headerSafe(value: string, max = 120): string {
  return value.replace(/[\u0000-\u001f\u007f<>"\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function adminInquiriesUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/admin/inquiries`;
}

/** Pure: builds the message so it can be tested without any transport. */
export function buildInquiryEmail(
  inquiry: NotifiableInquiry,
  opts: { from: string; to: string; siteUrl: string; submittedAt: Date },
): MailMessage {
  const submitted = opts.submittedAt.toLocaleString("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Brussels",
  });
  const adminUrl = adminInquiriesUrl(opts.siteUrl);

  const text = [
    "New project request",
    "",
    `Name: ${inquiry.name}`,
    `Email: ${inquiry.email}`,
    `Project type: ${inquiry.projectType}`,
    `Budget: ${inquiry.budget}`,
    "",
    "Message:",
    inquiry.message,
    "",
    `Submitted: ${submitted} (Brussels time)`,
    "",
    `View in admin: ${adminUrl}`,
  ].join("\n");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top">${label}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`;

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111;line-height:1.5">
<h2 style="margin:0 0 16px">New project request</h2>
<table style="border-collapse:collapse">
${row("Name", inquiry.name)}
${row("Email", inquiry.email)}
${row("Project type", inquiry.projectType)}
${row("Budget", inquiry.budget)}
</table>
<p style="margin:20px 0 6px;color:#666">Message</p>
<div style="white-space:pre-wrap;border-left:3px solid #ddd;padding:2px 0 2px 12px">${escapeHtml(inquiry.message)}</div>
<p style="margin:20px 0 6px;color:#666">Submitted</p>
<p style="margin:0">${escapeHtml(submitted)} (Brussels time)</p>
<p style="margin:20px 0 0"><a href="${escapeHtml(adminUrl)}">View in admin</a></p>
</body></html>`;

  return {
    from: { name: SENDER_NAME, address: opts.from },
    to: opts.to,
    // Replies go straight to the lead. The SMTP sender is never the visitor's address.
    replyTo: { name: headerSafe(inquiry.name, 80), address: inquiry.email },
    subject: `New project request — ${headerSafe(inquiry.projectType, 60)}`,
    text,
    html,
  };
}

export type NotifyOutcome = "sent" | "disabled" | "failed";

/**
 * Best-effort notification AFTER the inquiry is stored. Never throws and never
 * reports an error to the caller: the database is the source of truth and an
 * email outage must not lose or fail a lead.
 */
export async function sendInquiryNotification(
  inquiry: NotifiableInquiry,
  deps: {
    transport?: MailTransport | null;
    env?: Record<string, string | undefined>;
    now?: () => Date;
  } = {},
): Promise<NotifyOutcome> {
  const env = deps.env ?? process.env;
  const transport = deps.transport === undefined ? getMailer(env) : deps.transport;

  if (!transport) {
    console.warn("[inquiry] notification email is disabled: SMTP is not configured (ZOHO_SMTP_*).");
    return "disabled";
  }

  try {
    const from = env.ZOHO_SMTP_USER?.trim() || "";
    const to = env.CONTACT_NOTIFICATION_EMAIL?.trim() || from;
    const siteUrl = env.NEXT_PUBLIC_SITE_URL?.trim() || "";
    if (!from || !to) {
      console.warn("[inquiry] notification email is disabled: sender or recipient is not configured.");
      return "disabled";
    }

    await transport.sendMail(
      buildInquiryEmail(inquiry, { from, to, siteUrl, submittedAt: (deps.now ?? (() => new Date()))() }),
    );
    return "sent";
  } catch (error) {
    // Only a code/name: SMTP errors can echo server responses, never log the full error or any credential.
    const code = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "unknown";
    console.error("[inquiry] notification email failed (inquiry was saved):", code);
    return "failed";
  }
}
