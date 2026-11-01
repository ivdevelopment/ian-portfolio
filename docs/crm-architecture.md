# CRM separation (P9)

`ianverlinden.com` is the public site, `ianverlinden.com/admin` is website administration, and **`crm.ianverlinden.com` is the CRM
workspace**. One codebase, one Next.js application, one Supabase project: no second backend, no copied data, no sync layer.

## 1. Audit of the repository before P9

**Deployments.** Vercel project `ian-portfolio` (apex, www, admin; Zoho secrets live here) and `preview-gateway` (the same repo built with
`PREVIEW_GATEWAY_ONLY=1`; answers nothing but `<name>.ianverlinden.com` client previews).

**Request pipeline** (`src/proxy.ts`): preview host → gateway rewrite; gateway-only deployment → 404; `/admin/*` → Supabase session refresh and
login guard; everything else → locale routing. The matcher cannot see `/api`, `/_next`, `/og` or files with an extension, so
`next.config.ts` rewrites handle those per host.

**Auth.** Supabase email + password, cookies written by `@supabase/ssr` as **host-only** cookies (no `Domain`), `path=/`, `SameSite=Lax`,
refreshed in the proxy. Authorisation is `admin_users` via `is_admin()`, re-checked in every page, server action and route handler
(`requireAdmin`) and again by RLS. There is no sign-up. Password recovery goes through `/admin/forgot-password` (PKCE code exchange on `/admin/reset-password`).

**Routes before P9** (all under `/admin`): website/CMS = dashboard, projects, previews, reviews, inquiries, media, pages, settings;
CRM = prospects (list, new, detail, edit, import, kanban, export, import API), quotes (list, new, detail, edit, templates, PDF),
settings → quotes, settings → integrations (Zoho connect/callback). Public routes: `/[locale]/…`, `/api/contact`, `/api/reviews/submit`,
`/og/*`, `/gw-preview/*` (internal, gateway only).

**Coupling found.** ~145 hard-coded `/admin/...` links in CRM components and pages; `requireAdmin` redirecting to `/admin/login`; two
cookies scoped to `/admin`; the preview host pattern (`<label>.ianverlinden.com`) would have claimed `crm.` as a client preview; the
Zoho OAuth redirect URI is `https://ianverlinden.com/admin/settings/integrations/zoho/callback`.

## 2. Decision: same application, hostname-based routing (Option A)

| Option | Verdict |
| --- | --- |
| **A. Same Next.js app, CRM tree served on its own host** | **Chosen.** |
| B. Third Vercel project from the same repo (like `preview-gateway`) | Rejected for now. It would need a *copy* of `ZOHO_TOKEN_ENCRYPTION_KEY` (a sensitive Vercel variable that cannot be read back), i.e. a new OAuth consent or key rotation, and a third build/env set to keep in sync. Everything is already isolated enough in code that it remains a cheap later hardening step. |
| C. Workspace/monorepo split | Rejected: no technical need; large migration for a subdomain. |

Why A is enough: the CRM lives in its own route tree (`src/app/(crm)/crm/*`, internally prefixed `/crm`), has its own root layout (no public
metadata, no analytics, `noindex`), its own shell, login and session, and the proxy makes the two surfaces mutually unreachable:

* On the CRM host the proxy serves **only** the `/crm` tree (rewritten from the visible URL: `/prospects` → `/crm/prospects`). The public
  site, `/admin`, `/gw-preview`, `/api`, `/og`, `sitemap.xml` and the public icon do not exist there; `robots.txt` disallows everything and
  every response carries `X-Robots-Tag: noindex`.
* On every other host `/crm/*` is a 404. The dedicated `preview-gateway` deployment answers 404 for the CRM host like for any non-preview host.
* `crm` is a reserved subdomain, so it can never be a client preview, and it is excluded from the preview-host patterns (matcher, security-header exclusion, gateway catch-all).

**One implementation, two mounts.** The CRM screens live once in `src/crm/{views,handlers,queries,actions}` and are mounted in the CRM tree
and, until retired, in `/admin`. Links come from a per-surface table (`src/lib/crm/paths.ts`, `getPaths()` on the server,
`useAppPaths()` in client components): the admin mount keeps its old URLs, the CRM uses clean ones.

## 3. Authentication

* Same identities and same authorisation as the website admin, **separate sessions**. Supabase cookies are host-only, so
  `crm.ianverlinden.com` and `ianverlinden.com` each hold their own; nothing is shared and nothing is widened to `.ianverlinden.com`
  (which would also have exposed the session to every client preview host). Logout ends only the session of the host it is used on.
* Cookie flags are unchanged (host-only, `path=/`, `SameSite=Lax`, `Secure` on https). The CRM login redirects to `/`; a signed-in but
  unapproved account is signed out with a message.
* Password recovery stays at the website admin (`/admin/forgot-password`); the CRM login links to it. No Supabase redirect-URL change is needed.
* `requireAdmin()` sends an expired CRM session to the CRM `/login`, not `/admin/login` (the `x-crm-app` header set by the proxy only
  chooses link targets and redirects, never authorisation).

## 4. Zoho

Read-only, unchanged scopes. The OAuth application and callback stay at the website admin (`/admin/settings/integrations`); the CRM
consumes the stored connection: mail history in the dossier, **Sync now** next to the mail and in CRM settings, and a link to manage the
connection. No new consent flow.

## 5. Source-of-truth rules

| Data | Owner |
| --- | --- |
| Prospects, activities, follow-ups | CRM |
| Quotes, quote services, quote settings | CRM |
| Email metadata (Zoho) | CRM (read-only) |
| Client preview access (viewed, counts) | Preview subsystem; shown in the CRM, managed (code, host, enable) in the website admin |
| Projects | Shared `projects` table: CRM shows client projects, website admin owns portfolio content |
| Public website content, SEO, reviews, media | Website admin |

**Clients** are not a table: a client is a prospect with status `won`. The page joins its project and accepted quotes.

## 6. Information architecture

CRM: Dashboard · Sales (Prospects, Pipeline, Follow-ups, Clients) · Work (Quotes, Projects) · Settings. Email is not a separate area (it is
inside each prospect, plus Sync in settings). Reserved for later (`planned` in `src/crm/nav.ts`, not rendered): Invoices, Payments.

Website admin: Dashboard · Portfolio · Client Previews · Reviews · Inquiries · Media · Pages · Settings · **Open CRM ↗**.

## 7. Retiring the legacy CRM routes (staged, reversible)

1. CRM deployed; legacy routes keep working (this is the state after step 1).
2. Production verification of the CRM.
3. Website admin navigation drops the CRM screens (shipped as its own commit).
4. `CRM_LEGACY_REDIRECTS=1` turns on 307 redirects (GET/HEAD, query kept) from `/admin/prospects…`, `/admin/quotes…` and `/admin/settings/quotes`
   to the CRM host. Remove the variable to go back. The Zoho connection pages, export/import-API handlers and all website-admin areas are never redirected.

## 8. Domain setup

1. Vercel: add the domain `crm.ianverlinden.com` to the **`ian-portfolio`** project.
2. Cloudflare DNS: **one** record, `CNAME crm → cname.vercel-dns.com`, **DNS only** (grey cloud), same as the existing client preview records. No wildcard, no changes to apex, `www`, `geertkips`, mail or Zoho records.
3. Optional env on `ian-portfolio`: `CRM_HOST` (defaults to `crm.ianverlinden.com`), `NEXT_PUBLIC_CRM_URL` (defaults to `https://crm.ianverlinden.com`), `CRM_LEGACY_REDIRECTS` (step 4 above).

Local development: `CRM_HOST=crm.localhost npm run build:local` / `start:local`, then open `http://crm.localhost:3300` (a separate cookie jar from `localhost`).

## 9. Not built in P9 (documented)

* **Global search** (prospects, clients, quote numbers, companies, emails). Each list has its own search; a cross-entity search is **P9.1**.
* **Invoicing, payments, e-invoicing/Peppol, VAT reporting.**
* **Organizations / contacts / opportunities refactor.** Today `prospect ≈ organization + contact + opportunity`. The CRM UI talks only to
  prospects through `src/crm/queries` and `src/lib/prospects`, so a later split into `Organization → Contacts + Opportunities` only changes
  those modules and the dossier header; no screen assumes more than one contact.
* **Splitting `projects`** into `client_projects` / `portfolio_projects`. They are one table today (a portfolio entry is a client job that was published).
  A split makes sense once a client job needs fields the public site must never see (budget, internal notes, milestones) or once jobs exist that are never published. Until then `client_id/prospect_id` on a separate `client_projects` table (with an optional `portfolio_project_id`) is the cleanest path; no schema change in P9.

## 10. Future billing boundary

```
CRM (prospect → quote → accepted → client → project)
        │   client_id, project_id, quote_id
        ▼
billing adapter (a small service interface owned by the CRM)
        │   external_invoice_id, invoice_number, invoice_status, payment_status
        ▼
e-invoicing system (Peppol, numbering, VAT reporting, payments)
```

The CRM stores only references and statuses returned by the adapter; it never learns Peppol, UBL or bank details. The invoice system is the
source of truth for invoice numbers, invoice and payment status; the CRM owns who the client is, what was quoted and accepted, and which
project it belongs to. A quote that is accepted can later carry `external_invoice_id` links; nothing is built yet.
