import { cacheLife, cacheTag } from "next/cache";
import { siteConfig } from "@/config/site";
import { isFramingAllowed, isProbeableUrl } from "@/lib/embed-policy";

/**
 * Can this site be shown in the project's live-preview iframe? The browser
 * gives the page no reliable signal when a site refuses framing (the iframe
 * still fires `load` and shows an error page), so we read the site's own
 * `X-Frame-Options` / `frame-ancestors` headers server-side. Cached for hours.
 *
 * Unknown (unreachable, slow, not probeable) counts as allowed: the client
 * still offers an "Open in a new tab" link and a timeout notice. A site
 * refusing to be framed is normal and not an application error.
 */
export async function isEmbeddable(url: string): Promise<boolean> {
  "use cache";
  cacheTag("embed-check");
  cacheLife("hours");

  if (!isProbeableUrl(url)) return true;
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; PortfolioEmbedCheck/1.0)" },
    });
    // Headers are all we need; don't download the page.
    await response.body?.cancel();
    return isFramingAllowed(
      {
        xFrameOptions: response.headers.get("x-frame-options"),
        contentSecurityPolicy: response.headers.get("content-security-policy"),
      },
      siteConfig.url,
    );
  } catch {
    return true;
  }
}
