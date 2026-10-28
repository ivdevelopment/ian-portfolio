import "server-only";

import { headers } from "next/headers";

/**
 * Base URL for links the admin copies (review invitations). Prefers the
 * configured public site URL; falls back to the current request's origin so
 * links are correct in local development and previews.
 */
export async function getPublicBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured && !/localhost|127\.0\.0\.1/.test(configured)) return configured;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return configured ?? "http://localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
