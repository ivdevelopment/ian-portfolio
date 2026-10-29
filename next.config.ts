import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
  : undefined;
const isLocalSupabase =
  supabaseUrl?.hostname === "127.0.0.1" || supabaseUrl?.hostname === "localhost";

const isProduction = process.env.NODE_ENV === "production";
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
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
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
