/**
 * Zoho Mail integration configuration. Everything is server-only and optional: with no configuration the CRM runs
 * exactly as before. The data center is configuration (the account is on the EU data center: MX is mx.zoho.eu and
 * SMTP is smtppro.zoho.eu), never hard-coded to .com.
 */
type Env = Record<string, string | undefined>;

/** Accounts (OAuth) and Mail API hosts per Zoho data center. EU and COM are documented; the Mail host is verified on first connect. */
export const ZOHO_DATA_CENTERS = {
  eu: { accounts: "https://accounts.zoho.eu", mail: "https://mail.zoho.eu" },
  com: { accounts: "https://accounts.zoho.com", mail: "https://mail.zoho.com" },
  in: { accounts: "https://accounts.zoho.in", mail: "https://mail.zoho.in" },
  "com.au": { accounts: "https://accounts.zoho.com.au", mail: "https://mail.zoho.com.au" },
  jp: { accounts: "https://accounts.zoho.jp", mail: "https://mail.zoho.jp" },
} as const;
export type ZohoDataCenter = keyof typeof ZOHO_DATA_CENTERS;

/** Least privilege for read-only sync: look up the account, read/search messages. Sending adds ZohoMail.messages.CREATE later. */
export const ZOHO_READ_SCOPES = ["ZohoMail.accounts.READ", "ZohoMail.messages.READ"] as const;

export type ZohoConfig = {
  /** The feature switch AND a complete configuration. */
  enabled: boolean;
  /** Why it is off, for the admin ("not enabled", "missing ZOHO_CLIENT_ID", …). Never contains a secret value. */
  reason: string | null;
  dataCenter: ZohoDataCenter;
  accountsUrl: string;
  mailUrl: string;
  clientId: string;
  clientSecret: string;
  /** 32 random bytes, base64. Encrypts stored refresh tokens and signs the OAuth state. */
  encryptionKey: Buffer | null;
  redirectUri: string;
  mailbox: string;
};

const isDataCenter = (v: string | undefined): v is ZohoDataCenter => Boolean(v) && Object.prototype.hasOwnProperty.call(ZOHO_DATA_CENTERS, v as string);

export function getZohoConfig(env: Env = process.env): ZohoConfig {
  const dataCenter: ZohoDataCenter = isDataCenter(env.ZOHO_DATA_CENTER) ? env.ZOHO_DATA_CENTER : "eu";
  const dc = ZOHO_DATA_CENTERS[dataCenter];
  const site = (env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const key = env.ZOHO_TOKEN_ENCRYPTION_KEY ? Buffer.from(env.ZOHO_TOKEN_ENCRYPTION_KEY, "base64") : null;

  const missing: string[] = [];
  if (env.ZOHO_MAIL_ENABLED !== "1") missing.push("ZOHO_MAIL_ENABLED=1");
  if (!env.ZOHO_CLIENT_ID) missing.push("ZOHO_CLIENT_ID");
  if (!env.ZOHO_CLIENT_SECRET) missing.push("ZOHO_CLIENT_SECRET");
  if (!key || key.length !== 32) missing.push("ZOHO_TOKEN_ENCRYPTION_KEY (32 bytes, base64)");
  if (!site) missing.push("NEXT_PUBLIC_SITE_URL");

  return {
    enabled: missing.length === 0,
    reason: missing.length === 0 ? null : env.ZOHO_MAIL_ENABLED !== "1" ? "Zoho Mail is not enabled on this deployment." : `Missing configuration: ${missing.join(", ")}.`,
    dataCenter,
    accountsUrl: env.ZOHO_ACCOUNTS_URL?.replace(/\/+$/, "") || dc.accounts,
    mailUrl: env.ZOHO_MAIL_API_URL?.replace(/\/+$/, "") || dc.mail,
    clientId: env.ZOHO_CLIENT_ID ?? "",
    clientSecret: env.ZOHO_CLIENT_SECRET ?? "",
    encryptionKey: key && key.length === 32 ? key : null,
    redirectUri: `${site}/admin/settings/integrations/zoho/callback`,
    mailbox: (env.ZOHO_MAILBOX ?? env.ZOHO_SMTP_USER ?? "").trim().toLowerCase(),
  };
}
