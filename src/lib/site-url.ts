type Env = Record<string, string | undefined>;

const LOCAL = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;

export function isLocalUrl(url: string): boolean {
  return LOCAL.test(url);
}

/**
 * The site's public origin, used for canonical URLs, Open Graph, sitemap,
 * robots and review invitation links. Order:
 *   1. NEXT_PUBLIC_SITE_URL (set this to the real domain)
 *   2. the Vercel production domain (so a Vercel-only launch is still correct)
 *   3. http://localhost:3000 — local development only
 * A real production deployment never falls back to localhost: it fails loudly.
 */
export function resolveSiteUrl(env: Env): string {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    const withProtocol = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
    return withProtocol.replace(/\/+$/, "");
  }

  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}`;

  if (env.VERCEL_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL is not set. Set it to the production origin (e.g. https://example.com) in the Vercel project's environment variables.",
    );
  }
  return "http://localhost:3000";
}
