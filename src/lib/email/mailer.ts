import "server-only";

import nodemailer from "nodemailer";

/** The only mail capability the rest of the app depends on (easy to mock in tests). */
export type MailMessage = {
  from: { name: string; address: string };
  to: string;
  replyTo?: { name: string; address: string };
  subject: string;
  text: string;
  html: string;
};
export type MailTransport = { sendMail: (message: MailMessage) => Promise<unknown> };

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

type Env = Record<string, string | undefined>;

/**
 * SMTP settings from the environment, or null when any required value is
 * missing (notifications are then disabled, never an error). The password is
 * server-only and never leaves this module's transporter.
 */
export function loadSmtpConfig(env: Env = process.env): SmtpConfig | null {
  const user = env.ZOHO_SMTP_USER?.trim();
  const password = env.ZOHO_SMTP_PASSWORD;
  if (!user || !password) return null;

  const port = Number(env.ZOHO_SMTP_PORT?.trim() || 465);
  if (!Number.isInteger(port) || port <= 0) return null;

  return {
    host: env.ZOHO_SMTP_HOST?.trim() || "smtppro.zoho.eu",
    port,
    // 465 = implicit TLS; 587 upgrades with STARTTLS.
    secure: port === 465,
    user,
    password,
  };
}

let cached: { config: string; transport: MailTransport } | null = null;

/** One reusable transporter per server instance; null when SMTP isn't configured. */
export function getMailer(env: Env = process.env): MailTransport | null {
  const config = loadSmtpConfig(env);
  if (!config) return null;

  const key = `${config.host}:${config.port}:${config.user}`;
  if (cached?.config === key) return cached.transport;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.password },
    // A mail outage must never hold the visitor's request for long.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
  const transport: MailTransport = { sendMail: (message) => transporter.sendMail(message) };
  cached = { config: key, transport };
  return transport;
}
