# Ian Verlinden — portfolio & web studio site

Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS v4 · Supabase (Postgres, Auth, Storage) · Zod · React Hook Form.

The public site renders projects managed in a small admin CMS at `/admin`.

## Local development

Requirements: Node 22+, Docker (for the local Supabase stack).

```bash
npm install
npm run db:start                  # starts local Supabase, applies migrations + seed
npx supabase status -o env        # prints the LOCAL url + keys

# Local env: keep local and hosted credentials in SEPARATE files (see below)
#   .env.supabase-local  -> the local Docker stack (used by dev:local / test:rls / admin:create)
#   .env.local           -> whatever Next.js should use by default (e.g. your hosted project)

npm run admin:create -- you@example.com   # LOCAL owner account (prompts for a password)
npm run dev:local                 # http://localhost:3000 against the LOCAL stack  ·  admin: /admin
```

### Local vs hosted: never mix them

`.env.local` may point at your **hosted** project. To make that safe:

- `npm run dev:local`, `build:local`, `start:local` run Next with `.env.supabase-local` (process env wins over `.env.local`) and refuse any non-loopback URL.
- `npm run test:rls` loads `.env.supabase-local` and the tests refuse to run against a non-local URL — they create and delete users and rows.
- `npm run admin:create` refuses non-local URLs unless you add `--remote`. **Never reuse a development password on a hosted project.**
- `npm run dev` / `npm run build` use `.env.local` (hosted, if that's what it contains).

| Command | What it does |
| --- | --- |
| `npm run db:start` / `db:stop` | Start / stop the local Supabase stack (ports 55321–55329) |
| `npm run db:reset` | Re-apply migrations and `supabase/seed.sql` (wipes local data) |
| `npm run db:types` | Regenerate `src/types/database.ts` from the local database |
| `npm run admin:create -- <email>` | Create or promote the admin (uses the service-role key, locally) |
| `npm test` | Unit tests (slugs, validation, media rules, mappers, route guards, review tokens, content schemas) |
| `npm run test:rls` | RLS / authorisation tests (P1 + P2) against the **local** Supabase stack |
| `npm run dev:local` / `build:local` / `start:local` | Run Next against the local stack only |
| `npm run typecheck`, `npm run lint`, `npm run build` | Quality gates |

## Environment variables

| Variable | Where | Required | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | app | **yes** | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app | **yes** | anon / publishable key. Safe to expose — Row Level Security protects data |
| `NEXT_PUBLIC_SITE_URL` | app | **yes (production)** | The real origin, e.g. `https://www.example.com`. Canonical URLs, Open Graph, sitemap, robots, review-invitation and password-recovery links. A real Vercel production build fails rather than fall back to localhost |
| `INQUIRY_HASH_SALT` | app | **yes (production)** | Long random secret for hashing visitor IPs (contact-form and review rate limiting). Without it a public default salt is used |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | app | optional | Cloudflare Turnstile site key (public) |
| `TURNSTILE_SECRET_KEY` | app (server) | optional | Turnstile secret. When set, the contact form **requires** a verified token |
| `ZOHO_SMTP_HOST` / `ZOHO_SMTP_PORT` | app (server) | optional | Zoho SMTP, default `smtppro.zoho.eu` / `465` (implicit TLS; `587` uses STARTTLS) |
| `ZOHO_SMTP_USER` / `ZOHO_SMTP_PASSWORD` | app (server) | optional | The Zoho mailbox and its (application-specific) password. Server-only; this mailbox is also the From address |
| `CONTACT_NOTIFICATION_EMAIL` | app (server) | optional | Where new-inquiry emails go (defaults to `ZOHO_SMTP_USER`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **your machine only** | no | Used solely by `scripts/create-admin.mjs` and `scripts/reset-admin-password.mjs`. **Never set it in hosting**, never prefix with `NEXT_PUBLIC_` |

The running application never uses the service-role key. Vercel's own variables (`VERCEL`, `VERCEL_ENV`, `VERCEL_PROJECT_PRODUCTION_URL`) are read automatically.

## Creating the first admin

There is no public registration, and sign-ups are disabled. Access requires **both** a Supabase Auth user **and** a row in `public.admin_users`.

1. Locally: `npm run admin:create -- you@example.com`.
2. Hosted project: either run the same script with the hosted `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exported in your shell, or:
   - Dashboard → Authentication → Users → **Add user** (set a password, tick "Auto Confirm User"), then
   - SQL editor: `insert into public.admin_users (user_id) select id from auth.users where email = 'you@example.com';`

To revoke access: `delete from public.admin_users where user_id = '…';`

### Password recovery and safe diagnostics

- **Forgot your password:** `/admin/forgot-password` emails a recovery link (the response is always the same, so it never reveals whether an address has an account). The link returns to `/admin/reset-password`, where a new password (10+ characters) is set; every session is then ended and you sign in again.
- **Locked out entirely** (no access to the email): `npm run admin:reset-password -- --remote you@example.com` updates the password of an *existing* user through the admin API. It never creates or deletes users and never touches `admin_users`. The password is typed at a hidden prompt.
- **Sign-in misbehaving:** `npm run admin:diagnose -- --remote you@example.com [--app http://localhost:3000]` replays the sign-in step by step and prints only pass/fail, cookie names and sizes. It never prints a password, token, cookie value or key.
- Both scripts refuse a non-local Supabase URL without `--remote`, need an interactive terminal, and read `.env.local`.

## Reviews and invitations (P2)

- **Invite a client:** Admin → Reviews → Invitations → *Request a review*. Choose the client, an optional project and 7/14/30 days. The link is shown **once** (copy it, then *Done*); it cannot be recovered.
- **Token security:** 256-bit random token (`crypto.randomBytes(32)`, base64url). Only its SHA-256 hash is stored (`review_invitations.token_hash`); the raw token is never persisted or logged. Single use, enforced atomically in the database (`submit_review()`), so two simultaneous submissions cannot both succeed.
- **One generic failure:** unknown, expired, revoked and used links all show *"This review link is no longer valid."* — nothing reveals which.
- **Moderation:** submissions arrive as **Pending** (never public). Approve / Reject / Archive / Feature / Edit / Delete in Admin → Reviews. The client's **original text** is kept in the admin-only `review_private` table; edit the *published text* freely.
- **Manual reviews:** *+ Add review* records a genuine review received elsewhere (`source = admin`).
- **Public:** approved reviews only — homepage (hidden when there are none), `/reviews`, and "Client feedback" on a linked project page. No review is ever seeded.
- Avatars go to the public `site-media` bucket (PNG/JPG/WebP, 2 MB for avatars, 10 MB for site images).

## Site content (P2)

Structured content, not a page builder: Admin → **Pages** (Home, About, Contact, Services) and **Settings** (site name, location, public email, social links, SEO defaults). Skills live under Pages → About. Defaults (the accepted wording) are seeded by the migration; the code only keeps structural fallbacks. Edits expire exactly the affected cache tags (`site-content`, `site-settings`, `services`, `skills`, `reviews`, `projects`).

## Setting up a hosted Supabase project

1. Create a project, then link it: `npx supabase link --project-ref <ref>`.
2. Apply the schema: `npx supabase db push` (applies **every** migration: P1 tables, then P2 reviews / invitations / site content, and creates the `project-media` and `site-media` buckets). Re-run it whenever a new migration is added.
3. Optional demo content: run `supabase/seed.sql` in the SQL editor (or `db push --include-seed`). Delete those sample rows once you have real projects.
4. Dashboard → Authentication → Sign In / Providers: keep **Email** enabled and turn **"Allow new users to sign up" OFF**. Set a minimum password length of 10+.
5. Dashboard → Authentication → URL Configuration: set the Site URL to your production domain.
6. Create the admin (above).
7. Set the app environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`). The build and ISR need the database to be reachable.

## Deploying to Vercel

1. Push the repository to GitHub and **Import** it in Vercel (framework preset: Next.js, production branch: `main`). No build or output overrides are needed; nothing depends on Docker, local files or a local database.
2. Add the environment variables above under *Settings → Environment Variables* for **Production** (and Preview if you want previews to work): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `INQUIRY_HASH_SALT`, and the two Turnstile keys. **Do not add the service-role key.**
3. Deploy. The first production build needs the hosted database to be reachable (public pages are prerendered from it).
4. Enable *Analytics* and *Speed Insights* on the Vercel project (Project → Analytics / Speed Insights → Enable). The code is already in place and only loads on Vercel; data appears after real traffic.
5. **Custom domain** (when you have one): Project → Settings → Domains → add it and follow the DNS instructions, then set `NEXT_PUBLIC_SITE_URL` to `https://<your-domain>`, redeploy, and update the Supabase URLs below.

### Supabase Auth — production URLs

Dashboard → Authentication → URL Configuration:

| Setting | Value |
| --- | --- |
| **Site URL** | the production origin, e.g. `https://www.example.com` |
| **Redirect URLs** | `https://www.example.com/admin/reset-password` and `http://localhost:3000/admin/reset-password`. Add your `*.vercel.app` production URL's `/admin/reset-password` too while you use it. No wildcards are needed |

Also: Authentication → Sign In / Providers → **Email enabled, "Allow new users to sign up" OFF**, minimum password length 10+. Recovery emails use Supabase's built-in sender (low hourly limit); add custom SMTP under Authentication → SMTP if you need more.

## Spam protection (Cloudflare Turnstile)

The contact form has validation, a honeypot field, a minimum fill time, a database-side rate limit and — when configured — Turnstile, verified **server-side** before anything is stored. The widget is `interaction-only`, so visitors normally never see it.

1. Cloudflare dashboard → Turnstile → *Add widget*; hostname(s): your production domain (and `localhost` if you want to test with real keys); mode **Managed**.
2. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in Vercel and redeploy.
3. Local development: leave both unset (not enforced), or use Cloudflare's always-pass test keys from `.env.example` to exercise the whole flow. Cloudflare also publishes always-fail test keys for the failure path.

### New-inquiry email

After an inquiry is **saved**, `src/lib/email/` sends a notification through Zoho SMTP (From: `Ian Verlinden Website <ZOHO_SMTP_USER>`, Reply-To: the visitor, plain-text + escaped HTML). It is best-effort: if SMTP is unset or down the visitor still gets the normal success message, the inquiry stays in Admin → Inquiries, and only a short error code is logged. Without the `ZOHO_SMTP_*` variables (local development) notifications are simply disabled.

If Cloudflare can't be reached the form fails closed with a retry message. Review invitations are not behind Turnstile: they already need a secret single-use token, an expiry and a rate limit.

## Security headers, SEO and analytics

- **Headers** (`next.config.ts`): `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`, COOP, and in production HSTS and a Content-Security-Policy. The CSP has no `unsafe-eval` and no wildcard script hosts. `unsafe-inline` remains for scripts/styles because Next's bootstrap is inline and a nonce would make every page dynamic. `frame-src https:` and `img-src/media-src https:` are deliberate (live-preview iframes, CMS media URLs). The policy is production-only because `next dev` needs eval and websockets.
- **SEO:** canonical, Open Graph and Twitter cards on every public page; generated 1200×630 share cards (`/opengraph-image`, per project when no raster thumbnail exists); WebSite / Person / ProfessionalService JSON-LD from Admin → Settings only (no review or rating markup). `/admin`, `/review/*` and error pages are `noindex`; `robots.txt` blocks `/admin` and `/review/`; the sitemap lists public pages and published projects only.
- **Analytics:** Vercel Web Analytics and Speed Insights — cookie-free, no session replay, public pages only (never `/admin`), and invitation tokens are stripped from reported URLs.
- **Live previews:** the server reads a site's `X-Frame-Options` / `frame-ancestors` and, when it refuses framing, shows the gallery and an "open the site" button instead of the browser's error page.
- **Project labelling:** *Concept* work is described as unofficial and not commissioned, *Personal* and *Sample* projects are tagged; the client row reads "Brand" for concepts.

## Architecture notes

- **Data access** — `src/lib/projects.ts` (public, cached, anonymous client) and the admin queries/actions run as the signed-in admin. Typed with generated `Database` types.
- **Public caching** — public reads use `'use cache'`, tagged `projects` and `project:<slug>`, with a 1-hour lifetime as a safety net. Every admin mutation calls `updateTag(...)`, so changes appear immediately.
- **`/work/[slug]`** — listed slugs are prerendered; `params` is awaited at the top (no Suspense) so unknown or draft slugs return a real HTTP 404. `partialPrefetching` was removed from `next.config.ts` for this reason (Cache Components is still on).
- **Protection of `/admin`** — three layers: `src/proxy.ts` (redirects visitors without a session), the panel layout and every page (`requireAdmin()` checks `admin_users` via `is_admin()`), and every server action. Database RLS is the final layer.
- **Project saves** are one transaction (`save_project()` SQL function): project, features and media ordering succeed or fail together.

## Media

Bucket: `project-media` (public read; only admins can upload, replace or delete). Files are stored as `projects/<project-id>/<uuid>.<ext>`.

| Type | MIME | Max size |
| --- | --- | --- |
| Image | `image/png`, `image/jpeg`, `image/webp` | 10 MB |
| GIF | `image/gif` | 15 MB |
| Video | `video/mp4` | 50 MB (bucket ceiling) |

Validated in the browser, again on the server (path ownership, type/extension match) and by Storage itself (MIME allow-list and size). SVG and HTML uploads are rejected. Unsaved uploads are removed if you cancel; files dropped from a project are removed when you save.

## Security summary

- RLS on every table. Anonymous visitors can read published projects (and their media/features) only. They cannot write anything, and cannot read inquiries or `admin_users`.
- Contact form → `submit_inquiry()` (SECURITY DEFINER): the anonymous role has **no** table privileges; the function enforces CHECK constraints and a per-visitor + global rate limit. The server action adds Zod validation, a honeypot and a minimum-fill-time check. IPs are stored only as salted hashes.
- Plain-text content only — React escapes everything; no raw HTML rendering.
- URLs are limited to `http(s)` (checked in Zod and in the database), so `javascript:`/`data:` links cannot be stored.
- Add Cloudflare Turnstile to the contact form later if spam becomes an issue.

## Content to replace before launch

Do this in the admin before promoting the site:

- **Settings:** replace the seeded contact email (`hello@ianverlinden.example` is hidden publicly until you do), location, social links and SEO text.
- **Projects:** unpublish or delete the seeded samples (Afroton, Lumen Studio, Nova Dashboard — flagged *Sample*) and any test project; publish real ones with correct *type* (client / personal / concept).
- **Reviews:** only real reviews — none are seeded. **About:** replace the portrait and wording.
- **Production smoke test:** submit one contact inquiry and one review invitation end to end, then delete them (Admin → Inquiries / Reviews).
