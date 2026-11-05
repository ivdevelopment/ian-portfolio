/**
 * Which contact details count as real. Web page templates and website builders ship with sample text ("gebruiker@domein.com",
 * "name@example.com", "+32 123 456 789"); such a value is NOT a way to reach the business and must never count as contactability.
 *
 * The rules are fixed and deterministic (no AI) and deliberately narrow: a placeholder DOMAIN, or a local part that is a template word in
 * any language we meet ("gebruiker", "voornaam.achternaam", "yourname"). Ordinary addresses ("info@", "mail@", "test@realcompany.be",
 * "user.support@acme.be") are never rejected on the local part alone.
 */

/** Registrable domains (and everything under them) that exist only as examples. */
const PLACEHOLDER_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "example.edu", "example.be", "example.nl", "example.eu",
  "domain.com", "domain.be", "domain.nl", "domain.org", "domain.net", "domein.com", "domein.be", "domein.nl", "domein.org",
  "mydomain.com", "mydomain.be", "uwdomein.be", "uwdomein.com", "jouwdomein.be", "jouwdomein.com", "jouwdomein.nl",
  "company.com", "yourcompany.com", "mycompany.com", "website.com", "yourwebsite.com", "site.com", "yoursite.com",
  "email.com", "test.com", "doe.com", "johndoe.com", "sample.com", "demo.com", "bedrijf.com", "uwbedrijf.be", "jouwbedrijf.be",
]);

/** "yourdomain.*", "yourcompany.*", "uwdomein.*", "jouwbedrijf.*" and similar, whatever the extension. */
const PLACEHOLDER_LABEL = /^(your|my|uw|jouw|mijn)[-_]?(domain|domein|company|bedrijf|bedrijfsnaam|website|site|email|mail|name)$/i;
/** Reserved example TLDs (RFC 2606/6761). */
const RESERVED_TLD = /\.(example|invalid|test|localhost)$/i;

/** Local parts that are template words. Rejected on any domain because no real mailbox is called this. */
const PLACEHOLDER_LOCALS = new Set([
  "gebruiker", "gebruikersnaam", "username", "yourname", "your.name", "your-name", "yourmail", "your.email", "youremail", "your-email", "yourname.surname",
  "uwnaam", "uw.naam", "uwemail", "uw.email", "uw-email", "jouwnaam", "jouw.naam", "jouwemail", "jouw.email",
  "voornaam", "achternaam", "voornaam.achternaam", "voornaam.naam", "naam.achternaam", "naam.voornaam", "firstname", "lastname", "firstname.lastname", "first.last", "firstlast",
  "example", "sample", "johndoe", "john.doe", "janedoe", "jane.doe", "emailadres", "e-mailadres", "email.address", "someone", "somebody",
]);

export type EmailVerdict = { ok: true; email: string } | { ok: false; reason: "invalid" | "placeholder" };

export function checkEmail(raw: string | null | undefined): EmailVerdict {
  const email = (raw ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return { ok: false, reason: "invalid" };
  const [local, domain] = [email.slice(0, email.lastIndexOf("@")), email.slice(email.lastIndexOf("@") + 1)];
  if (RESERVED_TLD.test(domain)) return { ok: false, reason: "placeholder" };
  const labels = domain.split(".");
  const registrable = labels.slice(-2).join(".");
  if (PLACEHOLDER_DOMAINS.has(registrable) || PLACEHOLDER_DOMAINS.has(domain)) return { ok: false, reason: "placeholder" };
  if (labels.length >= 2 && PLACEHOLDER_LABEL.test(labels[labels.length - 2])) return { ok: false, reason: "placeholder" };
  if (labels.length >= 2 && /^x{2,}$/.test(labels[labels.length - 2]) && /^x{2,}$/.test(local)) return { ok: false, reason: "placeholder" };
  if (PLACEHOLDER_LOCALS.has(local)) return { ok: false, reason: "placeholder" };
  return { ok: true, email };
}

export const isPlaceholderEmail = (raw: string | null | undefined): boolean => {
  const v = checkEmail(raw);
  return !v.ok && v.reason === "placeholder";
};

/** The address when it is a real-looking, non-placeholder email; otherwise null ("no verified email"). */
export const verifiedEmail = (raw: string | null | undefined): string | null => {
  const v = checkEmail(raw);
  return v.ok ? v.email : null;
};

/** A phone number that is plausible: enough digits, not all one digit, not a counting sequence ("123456789", "0123456789"). */
export function verifiedPhone(raw: string | null | undefined): string | null {
  const phone = (raw ?? "").trim();
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (/^(\d)\1+$/.test(digits)) return null;
  if (/(?:1234567|9876543)/.test(digits)) return null;
  return phone;
}
