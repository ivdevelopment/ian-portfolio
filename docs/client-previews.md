# Client previews

Private, access-code protected previews of client websites, each on its own subdomain
(`https://geertkips.ianverlinden.com`), managed in **Admin → Client Previews**.

## How it works

```
https://<name>.ianverlinden.com
        │  (Host header validated: exactly one label under PREVIEW_BASE_DOMAIN, not reserved)
        ▼
src/proxy.ts  ──rewrite──▶  /gw-preview/…  (internal route, preview hosts only)
        ▼
Gateway:  look up preview state (every request)  →  no session? branded access screen
        │                                          →  session ok? continue
        ▼
Reverse proxy ──▶ the client's own deployment (target URL, never shown to the visitor)
```

* **Same codebase, separate deployment (recommended).** Create a second Vercel project from this repository
  (e.g. `preview-gateway`) with `PREVIEW_GATEWAY_ONLY=1`. It answers preview hostnames and returns 404 for
  everything else. The main `ian-portfolio` project never serves preview hosts, so a gateway bug, a bad env value or
  a rollback cannot touch `ianverlinden.com`, and moving a hostname between projects is the rollback.
  Running the gateway inside the main project also works (`PREVIEW_GATEWAY_ONLY` unset) but has a larger blast radius.
* **Isolation guarantees.** Preview hosts get none of the portfolio's headers/CSP (`next.config.ts` excludes them), no
  portfolio layout, locale routing, analytics or Speed Insights (those only exist in the public layout), and the
  portfolio's own routes can never be reached through a preview hostname (every path belongs to the client's site).
* **No service-role key.** The gateway uses three anonymous-callable `SECURITY DEFINER` functions
  (`preview_gate`, `preview_target`, `verify_preview_access`). Nothing else about the database is exposed.

## Security model

| Concern | Design |
| --- | --- |
| Access code storage | Only a **bcrypt** hash (pgcrypto, cost 12, random salt) computed and checked *inside the database*. The hash column cannot be read through the API by any role, so it cannot be fetched for offline guessing. |
| Code format | Generated: `GK-7F3K-9MQX-P4TD` (~59 bits, no look-alike characters). Manual codes: ≥ 10 characters, not repetitive, not digits only. Shown once (create/reset), never recoverable. |
| Brute force | 5 failed attempts / 15 min per visitor (hashed IP) and 40 per preview; checked *before* any hashing; never a permanent lock; no counts revealed. IPs are `sha256(PREVIEW_IP_HASH_SALT:ip)`. |
| Session | Stateless cookie `__Host-pv_session` = `v1.<payload>.<HMAC-SHA256>` (key derived from `PREVIEW_SESSION_SECRET`). `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain` (host-only). Payload: preview id, subdomain, session version, issued/expiry. No access code inside. |
| Cookie scope | Host-only **and** bound to the preview id + subdomain: a session for `geertkips` is rejected by every other preview. |
| Revocation | The preview is re-checked on **every** request. Reset code, disable, or re-pointing the target bump `session_version` → every old cookie dies at once (re-enabling does not revive them). Expiry is evaluated per request (no cron). A tiny in-memory state cache (default 5 s) bounds how long one server instance may lag. |
| Host header | Untrusted. Accepted only as exactly `<one valid label>.<base domain>` (optional port); apex, `www`, reserved names, nested labels, look-alikes, credentials, odd characters are not preview hosts. |
| SSRF | Target must be `https://`, a public DNS name (no IPs in any notation, no localhost/internal suffixes, no credentials/ports/paths), never this site. Checked when saved, in the database (CHECK), on every request, and **at connection time** on the resolved IP (private, loopback, link-local, metadata, CGNAT, mapped/NAT64/6to4 IPv6 are refused) — defeats DNS rebinding. Redirects are never followed by the gateway. |
| CSRF | The login POST must carry this host's `Origin` (or `Sec-Fetch-Site: same-origin`/matching `Referer` when the browser sends `Origin: null`). |
| Caching | Every gateway response is `private, no-store` (+ `CDN-Cache-Control`/`Vercel-CDN-Cache-Control: no-store`, `Vary: Cookie`), overriding whatever the client's site sends. Nothing protected can be served from a shared cache. |
| Indexing | `X-Robots-Tag: noindex, nofollow, noarchive` on everything; `/robots.txt` is always `Disallow: /`; no sitemap; no canonical to the portfolio. |
| Logging | Structured events with preview id/subdomain and outcome only. Never codes, tokens or IP addresses. |

### Known limit (read this)

The gateway protects the **preview hostname**. It cannot protect the client's *underlying* address if that is public:
anyone who learns `https://geertkips-concept.<account>.workers.dev` can open the site directly. Mitigations, in order
of effort: keep the origin address unguessable and unlisted; have the origin require a shared secret header that only the
gateway sends (a small change in the client's Worker); or serve the origin only to the gateway (Cloudflare Workers can do
this with a service binding if the gateway itself runs on Cloudflare). The schema leaves room for an "upstream secret".

## What the proxy does with headers and cookies

* **Request →** only an allow-list is forwarded (accept*, content-type, range, conditional headers, user-agent,
  authorization, Next.js RSC/action headers). `Origin`/`Referer` are rewritten to the target. `Accept-Encoding: identity`
  is forced so text can be rewritten (the CDN compresses for the visitor). **Cookies**: the portfolio's (`sb-*`,
  `site-locale`) and the gateway's (`pv_*`, `__Host-pv_*`) are stripped; the client's own are passed through.
* **Response ←** hop-by-hop and platform headers are dropped; `Location` on the client's own origin and the client's own
  absolute URLs in HTML/CSS/JS/JSON/RSC text are rewritten to the preview hostname; `Set-Cookie` loses `Domain` (host-only)
  and any cookie that could collide with the gateway's is dropped; the client's CSP keeps working with its origin rewritten.
* **Not rewritten:** third-party hosts (browsers load external CDNs directly), compressed or > 8 MB bodies, binaries
  (streamed untouched). A redirect to a *different* host is passed through as is (the visitor leaves the preview).
* **Limits:** request bodies ≤ 4 MB; 10 s to first byte, 20 s idle; large media is streamed through a serverless function,
  so prefer a CDN for heavy assets. WebSockets are not proxied. If the client's site hard-codes its own absolute origin
  inside *compressed* or *base-64* data, that reference is not rewritten.

## Environment variables

| Variable | Where | Notes |
| --- | --- | --- |
| `PREVIEW_SESSION_SECRET` | gateway | ≥ 32 chars. Missing/short → the gateway fails closed ("not available"). Rotating signs everyone out. |
| `PREVIEW_IP_HASH_SALT` | gateway | ≥ 16 chars. |
| `PREVIEW_BASE_DOMAIN` | gateway + main | Default `ianverlinden.com`. |
| `PREVIEW_GATEWAY_ONLY` | gateway project only | `1` = answer preview hosts only (404 elsewhere). |
| `PREVIEW_UPSTREAM_SECRET_<REF>` | gateway project only | Shared secret (≥ 24 chars) for the preview whose `upstream_secret_ref` is `<ref>` (upper-cased), e.g. `PREVIEW_UPSTREAM_SECRET_GEERTKIPS`. Mark as sensitive. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | gateway + main | Same Supabase project. |

None is `NEXT_PUBLIC_*` (except the existing Supabase public pair). **Never** set the service-role key in either project.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # run twice: secret and salt
```

## Revocation is immediate

Preview state is read from the database on **every** request (`preview_gate` + `preview_upstream`); nothing is cached. Disabling a preview, resetting its code, changing its target or upstream auth, or letting it expire is therefore enforced on the visitor's very next request (disable/target/upstream changes also bump `session_version`, so re-enabling never revives an old session). The cost is two small RPCs per proxied request.

## Protecting the client's origin (shared secret)

A client's origin (e.g. a Worker on `workers.dev`) is public and would bypass the gateway. The origin should only answer requests that carry a shared secret:

- `client_previews.upstream_auth_type` = `header`, `upstream_header_name` (e.g. `x-ik-gateway-auth`) and `upstream_secret_ref` (e.g. `geertkips`). These are names, not secrets, and readable by admins only.
- The **value** lives only in the gateway project's environment (`PREVIEW_UPSTREAM_SECRET_GEERTKIPS`) and in the origin's own secret store. The database never holds it, so a database leak reveals nothing and each preview can have its own credential.
- The gateway sends the header only to that preview's origin, replaces anything a visitor sends under that name, fails closed (503, no request to the origin) if the secret is not configured, and never logs or returns it.
- Changing any of these settings ends existing sessions. They are set with SQL for now (no admin form field yet).
- Geert Kips' Worker (`worker/index.js`) requires the header on every host except `UNGATED_HOSTS` (its still-public custom domain), answering a bare `404` otherwise, and compares in constant time. Remove the custom domain from `UNGATED_HOSTS` when it is migrated.

## Database

`supabase/migrations/20261031000000_client_previews.sql` (apply with `npx supabase db push`; tested on a local stack by
`npm run test:rls`, 20 checks covering privileges, hashing, rate limits, session generations, expiry and disable).
Gateway deployed *before* the migration is applied → previews show "temporarily unavailable"; the portfolio is unaffected.

## DNS and Vercel (no wildcard)

Current DNS (inspected 2026-10-31): nameservers are Cloudflare (`jobs.ns.cloudflare.com`, `lina.ns.cloudflare.com`);
apex `A 216.198.79.65 / 64.29.17.65`, `www CNAME …vercel-dns-017.com` (Vercel, DNS only); mail `MX mx.zoho.eu / mx2 / mx3`,
SPF and DKIM (`zmail._domainkey`) present; **no `_dmarc` record**; **no wildcard record**; `geertkips` is a Cloudflare
Worker custom domain (proxied). Nothing in this feature changes any of these records.

**Use one explicit subdomain per preview, not `*.ianverlinden.com`.** Per Vercel's documentation a wildcard domain on
external DNS needs the `_acme-challenge` NS delegation workaround (or Vercel nameservers), the docs do not say whether an
exact subdomain in another project beats a wildcard, and a wildcard record would also answer `anything.ianverlinden.com`
that you may not want. Explicit subdomains are how `www` already works and give automatic certificates:

1. Vercel → gateway project → Settings → Domains → add `geertkips.ianverlinden.com`. Vercel shows the project's own
   CNAME target (like `xxxxxxxxxxxxxxxx.vercel-dns-017.com.`). **Use that exact value; the existing `www` value belongs to the main project.**
2. Cloudflare → DNS → add `CNAME geertkips → <that value>`, **DNS only** (grey cloud) so Vercel can issue the certificate.
3. The admin list then shows **Ready** once the hostname answers as the gateway (it asks the hostname's own `/robots.txt`),
   `Not on gateway` while something else answers, and `DNS pending` when nothing does.

Each project is limited by plan (Hobby: 50 custom domains per project); structure the code for future automation
(Vercel Domains API) by keeping hostname = `<subdomain>.<base domain>` derived, never hard-coded.

## Geert Kips — the first real preview

**Discovery (important):** `Client Websites/geert-kips-concept` is **not** a Vercel project. It is a Cloudflare Worker
with static assets (`wrangler.jsonc`: `name geertkips-concept`, `routes: geertkips.ianverlinden.com` as a *custom domain*,
`workers_dev: false`, `preview_urls: false`). It has **no separate origin address at all** today; the hostname *is* its
only address. A gateway must be able to fetch it somewhere else, and a hostname can belong to only one place.

Record to create (Admin → Client Previews → New preview):

| Field | Value |
| --- | --- |
| Client name | Geert Kips |
| Project name | Geert Kips Website |
| Subdomain | `geertkips` |
| Target URL | the Worker's origin address from step 1 below (`https://geertkips-concept.<your-workers-subdomain>.workers.dev`) — **not guessed here** |
| Expiry / session | as you prefer (default: never / 7 days) |

### Safe migration order (no downtime until step 9, then ~minutes)

1. **Apply the DB migration** (`supabase db push`) and **create the gateway Vercel project** from this repo with the env vars
   above (`PREVIEW_GATEWAY_ONLY=1`). Do not add any domain yet. Deploy.
2. **Give Geert's Worker an origin address *in addition to* its custom domain** (nothing is detached yet): in
   `geert-kips-concept/wrangler.jsonc` set `"workers_dev": true`, `npm run deploy`. Note the `…workers.dev` URL Cloudflare prints.
   Confirm it loads. (`geertkips.ianverlinden.com` keeps working untouched.)
3. **Create the record for a *temporary* hostname first**, e.g. subdomain `geertkips-test` with the workers.dev target and a
   fresh code. (Same target, so this tests the real path without touching the live address.)
4. Vercel (gateway project) → add `geertkips-test.ianverlinden.com`; Cloudflare → `CNAME geertkips-test → <value>` (DNS only).
5. **Verify on `https://geertkips-test.ianverlinden.com`:** access screen; wrong code → "Ongeldige toegangscode."; right code →
   the site; reload (still in); navigate several pages; check images, fonts, CSS, JS and no `workers.dev` address in the
   address bar or page source; open in a private window (asks for the code again); admin list shows **Ready**.
6. **Test revocation:** reset the code (old session must be thrown out), disable (must show "niet beschikbaar" at once),
   re-enable (needs the new login).
7. Create the **real** record: subdomain `geertkips`, same target. Do not point DNS at it yet.
8. **Maintenance window (≈ minutes). Switch:** in `geert-kips-concept/wrangler.jsonc` remove the `routes` custom-domain entry
   (keep `workers_dev: true`) and `npm run deploy` — Cloudflare detaches `geertkips.ianverlinden.com` (normally removing the DNS record it created; if a
   `geertkips` record is still listed, delete it). Immediately: Vercel gateway project → add `geertkips.ianverlinden.com`; Cloudflare → `CNAME geertkips → <value>` (DNS only).
9. Wait for Vercel's certificate (usually < 2 minutes), then verify live exactly as in step 5, plus: the admin list shows **Ready**.
10. Delete the temporary `geertkips-test` record, its Vercel domain and its CNAME.
11. **Send the client the URL and code** (code shown once at creation; reset to issue a new one).

### Rollback (any time before step 10, ~2 minutes)

* Cloudflare: delete the `geertkips` CNAME. Vercel: remove the domain from the gateway project.
* `geert-kips-concept/wrangler.jsonc`: restore `"routes": [{ "pattern": "geertkips.ianverlinden.com", "custom_domain": true }]`
  and `npm run deploy` → Cloudflare re-attaches the custom domain and recreates its DNS record. The site is back exactly as it was.
* The Geert record can stay (inactive DNS) or be disabled in the admin; nothing else was changed.

Optional hardening afterwards: make the Worker (add a `main` script) reject requests that lack a secret header the gateway
sends, so the `workers.dev` address stops being an open back door (see "Known limit").

## Admin behaviour

* **List** shows client, project, preview URL, target *hostname*, state (Active / Disabled / Expired), domain status,
  expiry, last opened and views (a counter of successful code entries; no visitor identities).
* **Reset code** replaces the hash and invalidates every session; **Disable** does too (and re-enabling needs a new login);
  **Delete** removes access only — the client's website, project and deployment are never touched.
* Editing the **subdomain or target** also ends existing sessions. Changing the subdomain changes the hostname: update DNS accordingly.

## Extension points (not built)

`client_previews(id)` is the anchor for: client comments / feedback pins, an "approve" action, preview versions
(a `preview_versions` table with a target per version), file sharing, a client portal, and automated provisioning
(add `provider`/`provider_domain_id` columns and call the Vercel or Cloudflare API from the server actions, which are
already the single write path). The gateway only needs `preview_gate`/`preview_target`, so these can be added without changing it.
