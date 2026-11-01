import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
  : undefined;
const isLocalSupabase =
  supabaseUrl?.hostname === "127.0.0.1" || supabaseUrl?.hostname === "localhost";

const isProduction = process.env.NODE_ENV === "production";

/** The CRM hostname (see src/lib/crm/host.ts). Build-time literal for the host conditions below. */
const crmHost = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test((process.env.CRM_HOST ?? "").trim().toLowerCase())
  ? (process.env.CRM_HOST ?? "").trim().toLowerCase()
  : "crm.ianverlinden.com";
const onCrmHost = [{ type: "host" as const, value: crmHost.replace(/\./g, "\\.") }];
const supabaseOrigin = supabaseUrl?.origin;

/**
 * Content-Security-Policy, deliberately specific:
 * - No `unsafe-eval`, no wildcard script hosts. Inline scripts stay allowed
 *   because Next's bootstrap scripts are inline and a nonce would force every
 *   page to render dynamically (losing static/cached pages).
 * - `frame-src https:` is required: project pages embed a live preview of the
 *   client's own site (any https origin). Sandboxed in the component.
 * - `img-src`/`media-src` allow https: because the CMS accepts external image
 *   and video URLs. Scripts, forms and framing of THIS site stay locked down.
 * Production only: `next dev` needs eval + websockets for HMR.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin ?? ""} https://challenges.cloudflare.com`.trim(),
  "frame-src https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(isProduction
    ? [
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
      ]
    : []),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The quote PDF embeds Geist; its font files are read at runtime, so they must be part of that route's serverless bundle.
  outputFileTracingIncludes: {
    "/crm/quotes/[id]/pdf": ["./node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf", "./node_modules/geist/dist/fonts/geist-sans/Geist-Medium.ttf", "./node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf"],
    "/admin/quotes/[id]/pdf": ["./node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf", "./node_modules/geist/dist/fonts/geist-sans/Geist-Medium.ttf", "./node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf"],
  },
  poweredByHeader: false,
  // Dedicated gateway deployment only: the client's own URL behaviour (/foo vs /foo/) must reach its origin
  // untouched, so Next must not normalise trailing slashes first. The main portfolio keeps the default.
  skipTrailingSlashRedirect: process.env.PREVIEW_GATEWAY_ONLY === "1",
  async headers() {
    return [
      {
        source: "/:path*",
        // Not for preview hosts: they show a client's own site, which must not inherit this site's CSP/headers
        // (the gateway sets its own, preview-specific headers). Keep the literal in sync with src/proxy.ts.
        missing: [{ type: "host", value: "(?!(?:www|crm)\\.)[a-z0-9-]+\\.(ianverlinden\\.com|localhost)" }],
        headers: securityHeaders,
      },
      // The CRM host is private: ask crawlers to ignore everything on it (together with robots.txt and the page metadata).
      { source: "/:path*", has: onCrmHost, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] },
    ];
  },
  /**
   * Dedicated preview-gateway deployment (PREVIEW_GATEWAY_ONLY=1 at build time): the proxy cannot see API routes
   * or files with an extension, so everything that is NOT a preview host is rewritten, before the filesystem,
   * to the gateway route, which answers 404. Without the flag (the main site) there are no rewrites at all.
   */
  async rewrites() {
    if (process.env.PREVIEW_GATEWAY_ONLY !== "1") {
      // The proxy cannot see API routes, OG routes or files with an extension, so the CRM host is kept clean here: it serves its own
      // robots.txt, and the public site's API, OG, gateway and sitemap routes do not exist on it.
      return {
        beforeFiles: [
          { source: "/robots.txt", has: onCrmHost, destination: "/crm/robots.txt" },
          // The CRM links its own (hashed) icon from its pages; the public site's icon and favicon do not exist on this host.
          { source: "/icon.svg", has: onCrmHost, destination: "/crm/not-available" },
          { source: "/favicon.ico", has: onCrmHost, destination: "/crm/not-available" },
          { source: "/sitemap.xml", has: onCrmHost, destination: "/crm/not-available" },
          { source: "/:area(api|og|gw-preview|_vercel)/:rest*", has: onCrmHost, destination: "/crm/not-available" },
        ],
        afterFiles: [],
        fallback: [],
      };
    }
    return {
      beforeFiles: [
        {
          source: "/:path*",
          missing: [{ type: "host", value: "(?!(?:www|crm)\\.)[a-z0-9-]+\\.(ianverlinden\\.com|localhost)" }],
          destination: "/gw-preview/not-a-preview-host",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    // Public Storage buckets: `project-media` and `site-media`.
    remotePatterns: supabaseUrl
      ? [
          {
            protocol: supabaseUrl.protocol.replace(":", "") as "http" | "https",
            hostname: supabaseUrl.hostname,
            port: supabaseUrl.port,
            pathname: "/storage/v1/object/public/project-media/**",
          },
          {
            protocol: supabaseUrl.protocol.replace(":", "") as "http" | "https",
            hostname: supabaseUrl.hostname,
            port: supabaseUrl.port,
            pathname: "/storage/v1/object/public/site-media/**",
          },
        ]
      : [],
    // Only when developing against a local Supabase (loopback address).
    dangerouslyAllowLocalIP: isLocalSupabase,
  },
};

export default nextConfig;
