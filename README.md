# Ian Verlinden — portfolio & web studio site

Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS v4 · Supabase (Postgres, Auth, Storage) · Zod · React Hook Form.

The public site renders projects managed in a small admin CMS at `/admin`.

## Local development

Requirements: Node 22+, Docker (for the local Supabase stack).

```bash
npm install
cp .env.example .env.local        # then fill in the values printed by the next command
npm run db:start                  # starts local Supabase, applies migrations + seed
                                  # (prints API URL and keys -> .env.local)
npm run admin:create -- you@example.com   # creates the owner account (prompts for a password)
npm run dev                       # http://localhost:3000  ·  admin: /admin
```

| Command | What it does |
| --- | --- |
| `npm run db:start` / `db:stop` | Start / stop the local Supabase stack (ports 55321–55329) |
| `npm run db:reset` | Re-apply migrations and `supabase/seed.sql` (wipes local data) |
| `npm run db:types` | Regenerate `src/types/database.ts` from the local database |
| `npm run admin:create -- <email>` | Create or promote the admin (uses the service-role key, locally) |
| `npm test` | Unit tests (slugs, validation, media rules, mappers, route guards) |
| `npm run test:rls` | RLS / authorisation tests against the **local** Supabase stack |
| `npm run typecheck`, `npm run lint`, `npm run build` | Quality gates |

## Environment variables

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | app | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app | anon / publishable key. Safe to expose — Row Level Security protects data |
| `NEXT_PUBLIC_SITE_URL` | app | Canonical URL, sitemap |
| `INQUIRY_HASH_SALT` | app (optional) | Secret salt for hashing IPs used by contact-form rate limiting |
| `SUPABASE_SERVICE_ROLE_KEY` | **your machine only** | Used solely by `scripts/create-admin.mjs`. Never set it in hosting, never prefix with `NEXT_PUBLIC_` |

The running application never uses the service-role key.

## Creating the first admin

There is no public registration, and sign-ups are disabled. Access requires **both** a Supabase Auth user **and** a row in `public.admin_users`.

1. Locally: `npm run admin:create -- you@example.com`.
2. Hosted project: either run the same script with the hosted `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exported in your shell, or:
   - Dashboard → Authentication → Users → **Add user** (set a password, tick "Auto Confirm User"), then
   - SQL editor: `insert into public.admin_users (user_id) select id from auth.users where email = 'you@example.com';`

To revoke access: `delete from public.admin_users where user_id = '…';`

## Setting up a hosted Supabase project

1. Create a project, then link it: `npx supabase link --project-ref <ref>`.
2. Apply the schema: `npx supabase db push` (creates tables, RLS, functions and the `project-media` bucket).
3. Optional demo content: run `supabase/seed.sql` in the SQL editor (or `db push --include-seed`). Delete those sample rows once you have real projects.
4. Dashboard → Authentication → Sign In / Providers: keep **Email** enabled and turn **"Allow new users to sign up" OFF**. Set a minimum password length of 10+.
5. Dashboard → Authentication → URL Configuration: set the Site URL to your production domain.
6. Create the admin (above).
7. Set the app environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`). The build and ISR need the database to be reachable.

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

Sample projects in the seed (flagged "Sample"), the placeholder reviews, `siteConfig.email`, the Red Harbor live URL, the About portrait (`aboutContent.photo`), and a raster Open Graph image.
