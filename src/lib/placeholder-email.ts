/**
 * Reserved example domains (RFC 2606/6761) can never be real inboxes. The
 * database seed ships one so the admin form isn't empty; the public site must
 * never show it as contact information.
 */
export function isPlaceholderEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return /(^|\.)(example|invalid|test|localhost)$/.test(domain) || /(^|\.)example\.(com|org|net)$/.test(domain);
}

/** The email to show publicly, or "" when it is empty or a placeholder. */
export function publicEmail(email: string | undefined | null): string {
  return email && !isPlaceholderEmail(email) ? email : "";
}
