import "server-only";

import { headers } from "next/headers";
import { siteConfig } from "@/config/site";
import { isLocalUrl } from "@/lib/site-url";

/**
 * Base URL for links the admin copies (review invitations, password recovery).
 * Uses the configured public site URL; only when that is a local address
 * (development) does it fall back to the current request's origin, so links
 * are correct on localhost and in previews but never localhost in production.
 */
export async function getPublicBaseUrl(): Promise<string> {
  if (!isLocalUrl(siteConfig.url)) return siteConfig.url;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return siteConfig.url;
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
