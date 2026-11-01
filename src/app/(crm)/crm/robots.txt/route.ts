/** The CRM is private: tell every crawler to stay away (the proxy rewrites /robots.txt on the CRM host to this). */
export function GET() {
  return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
