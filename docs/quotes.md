# Quotes (offertes)

Prospect → create quote → generate a branded PDF → **send it yourself** → track the answer → accepted → project / won.

Admin only, under `/admin/quotes`. Nothing here is public, nothing is emailed by the app, and there is no invoicing, payment or
digital-acceptance feature (see [Not built](#not-built)).

## Data model

Migration `supabase/migrations/20261103000000_quotes.sql` (additive only).

| Table | Purpose |
| --- | --- |
| `quotes` | One quote: number, status, client snapshot, texts, currency, discount, **stored** totals, validity, timestamps. |
| `quote_items` | Its lines, in `position` order, with the per-line amounts. |
| `quote_activities` | Append-only audit trail (created, edited, ready, sent, accepted, rejected, cancelled, validity changed, PDF downloaded, duplicated, project linked). |
| `quote_item_templates` | Reusable services for "Add service". Prices are empty on purpose. |
| `quote_settings` | One row: defaults for new quotes and the business details printed on the PDF. |
| `quote_counters` | One row per year for numbering. No grants: only the numbering function touches it. |

All six tables have RLS enabled, nothing is granted to `anon`, and every policy requires `is_admin()`.

### Relationships and snapshots

* `quotes.prospect_id` and `quotes.project_id` are **optional** and `ON DELETE SET NULL`. A prospect can have many quotes (no `quote_id` on
  the prospect). Deleting a prospect or a project **never deletes a quote**.
* A quote stores its own copy of the client (`client_name`, `client_company`, `client_email`, `client_address`) and each line stores its
  own title, description, unit, price and VAT. Editing or deleting the prospect, the project or a service template later never changes an
  existing quote (`quote_items.template_id` is provenance only, `ON DELETE SET NULL`).
* Creating a quote from a prospect prefills company, contact person and email. **No address is invented** and the prospect is not changed.

### Numbering

`Q-YYYY-NNNN`, e.g. `Q-2026-0004` (the year is the Brussels year). `allocate_quote_number(year)` does
`INSERT … ON CONFLICT (year) DO UPDATE SET last_number = last_number + 1` inside the transaction that creates the quote:

* concurrent creations serialize on the counter row (no duplicates; `quote_number` is also `UNIQUE`),
* a failed creation rolls the counter back (no gaps),
* a new year restarts at `0001`,
* the number never changes after creation (a trigger refuses it).

## Money

All arithmetic lives in **one module**, `src/lib/quotes/money.ts` (`calculateQuote`). The builder, the server action that saves, the
detail page, the PDF and the dashboard all use it, so a figure cannot differ between screens.

* Exact decimal arithmetic on scaled integers (BigInt): quantity has 3 decimals, prices 2, percentages 2. **No floating point.**
  The database stores `numeric`.
* **Rounding rule: half up to the cent, at every stage, in this order**
  1. line gross = round(quantity × unit price)
  2. line discount = round(gross × discount %); `line_subtotal` = gross − discount (excl. VAT)
  3. quote-level discount (optional): a fixed amount, or round(Σ `line_subtotal` × %). It is spread over the lines in proportion to
     `line_subtotal` using the largest-remainder method, so the shares add up to the discount **to the cent**.
  4. line VAT = round((`line_subtotal` − share) × VAT %). **VAT is rounded per line and total VAT is the sum of the rounded lines**, so every
     figure on a quote adds up exactly (no "1 cent off" between lines and totals).
  5. `line_total` = `line_subtotal` − share + `line_tax`
* Totals: `subtotal` = Σ `line_subtotal`; `discount_total` = quote-level discount; `tax_total` = Σ `line_tax`;
  `total` = `subtotal` − `discount_total` + `tax_total`. VAT is also shown per rate.
* VAT rates per line: 0 / 6 / 12 / 21 %. The person chooses; nothing is decided automatically. (A future invoice module should compute VAT per
  rate on the summed base; a quote is not a tax document.)
* Rejected: negative quantity, price or VAT; a discount above 100 %; more decimals than allowed (it never silently rounds an input); a
  quote discount larger than the subtotal.
* **The server recalculates** from the raw inputs on every save (`toRpcPayload`); what the browser calculated is never trusted. The
  database re-checks the identities (`quotes_total_identity`, `quote_items_total_identity`, and `quotes_assert_consistent` comparing the
  header with the lines) and rolls the whole save back if they do not hold.

## Status workflow

`draft → ready → sent → accepted | rejected`, plus `expired` and `cancelled`.

| From | To |
| --- | --- |
| draft | ready, cancelled |
| ready | draft, sent, cancelled |
| sent | accepted, rejected, expired, cancelled |
| expired | sent (validity extended), accepted, rejected, cancelled |
| accepted / rejected | cancelled |
| cancelled | — |

* The rules are enforced by the trigger `quotes_guard` (for everyone) and mirrored in `src/lib/quotes/constants.ts` for the UI.
* **Ready/Sent require** a client name, a title and at least one line (and the app also checks valid quantities, a valid-until date, VAT
  rates and currency). Drafts may be incomplete but never malformed.
* **Content is locked** once a quote leaves draft/ready: its fields, its lines (RLS) and its totals cannot change. Only the validity
  (sent/expired) and the prospect/project links can. To revise, **Duplicate**.
* **Expired is derived**: a *sent* quote past `valid_until` is *shown* as Expired (`effectiveStatus`); nothing is written automatically.
  It can still be accepted or rejected, or reopened by extending the validity.
* **Delete** is only possible for drafts (RLS). Everything else is kept; cancel it instead. Rejecting stores an optional note.
* **Duplicate** creates a new draft with a new number, copied content and lines, no sent/accepted/rejected dates, and a fresh validity.
* There is **no versioning**: a revision is a new quote (duplicate). A future "revision of Q-…" link is possible without schema changes to
  existing rows.

## Admin screens

* `/admin/quotes` – list (Quote, Client, Prospect, Status, Created, Valid until, Total, Actions), filter by status / created date /
  prospect, search by number, client, company, prospect, title. Filters live in the URL. Cards below 1280px, table above.
* `/admin/quotes/new?prospect=<id>`, `/admin/quotes/[id]/edit` – the builder: repeatable lines (title, description, quantity, unit, price,
  discount %, VAT), live Excl. VAT / VAT per rate / Incl. VAT, **+ Add service** (templates become editable snapshot lines), accessible
  reorder (up/down buttons), the usual dirty-state save bar.
* `/admin/quotes/[id]` – detail: Edit, Preview PDF, Download PDF, Mark ready / sent / accepted / rejected, Extend validity, Duplicate,
  Cancel, Delete draft, Create project.
* `/admin/quotes/templates` – manage services. `/admin/settings/quotes` – defaults (language, VAT, validity, intro, terms) and business
  details (name, tagline, email, website; phone, address, VAT number, IBAN are optional and printed **only when filled in**).

## PDF

`src/lib/quotes/pdf/` – drawn with **pdf-lib** (pure JavaScript, no headless browser, works on Vercel serverless). Geist (the site's
typeface) is embedded as subsets from the installed `geist` package; `outputFileTracingIncludes` in `next.config.ts` ships the three
font files with the route.

* A4, navy accent. Letterhead, client block, quote number / date / valid until, title, introduction, line table (the header repeats on every
  page; rows break across pages line by line), totals (kept together), notes, terms, footer with business details and "page n of m".
* Dutch (default) and English labels per quote (`Offerte`, `Offertenummer`, `Datum`, `Geldig tot`, `Omschrijving`, `Aantal`, `Prijs`, `BTW`,
  `Totaal` … / `Quote`, `Quote number`, `Date`, `Valid until`, `Description`, `Qty`, `Price`, `VAT`, `Total` …).
* **Deterministic**: the same quote gives the same bytes (fixed font names, metadata dates from the quote).
* Characters the font cannot draw become `?`; control characters are dropped.
* Discounts are explicit: a Discount column when a line has one, "line discounts (already included)" and the quote-level discount as
  Subtotal / Discount rows.
* File name: `Q-2026-0004-geert-kips.pdf`.

### PDF security

* Generated **on request** for the signed-in admin only: `GET /admin/quotes/[id]/pdf` (inline preview) and `?download=1` (attachment, also
  logged as "PDF downloaded"). Unauthenticated requests are redirected to login by the proxy and answered 404 by the handler; cross-site
  requests are refused.
* **Nothing is stored**: no file at rest, no storage bucket, no public or predictable URL, no token to leak. `Cache-Control: private, no-store`.
* Only the main `ian-portfolio` project serves it; the `preview-gateway` deployment answers 404 for every non-preview host path.

## CRM integration

* Prospect page: **Create quote** (prefilled), a **Quotes** list in *Related* (number, status, total, links), and quote events on the
  timeline (*created, sent, accepted, rejected, cancelled*). The timeline reads them from `quote_activities` and links to the quote; nothing
  is copied into `prospect_activities`.
* **Nothing changes the CRM automatically.** After *Mark sent* the app asks "Move the prospect to Quote sent?"; after *Mark accepted* "Mark
  the prospect as won?" (each with an optional "also set the prospect's quote value"). Cancelling the question changes nothing.
  *Create project* (accepted quotes) creates an **unpublished** project draft, links it to the quote and marks the prospect won — after
  confirmation, never published.
* `prospects.quote_value_eur` stays as the **manual** field it was. It is never overwritten silently. The prospect page shows the *latest
  active quote* (ready, sent within validity, or accepted; newest first) next to it, excl. VAT, and says when the two differ.
* Dashboard: a compact **Quotes** panel (drafts / sent / accepted counts, accepted and open quoted value). Values are **net (excl. VAT, after
  discounts)**. Open = ready + sent (not expired). Rejected, cancelled and expired quotes never count as open pipeline.

## Tests

* `tests/quotes-money.test.ts` – calculations: one/many lines, VAT 0/6/12/21, discounts (line, percent, fixed, 100 %), decimals, half-up
  rounding, consistency on 300 random quotes, negatives and malformed input.
* `tests/quotes-status.test.ts`, `tests/quotes-list.test.ts` – transitions, derived expiry, validation, payloads, filters, metrics,
  mapping, CRM rules.
* `tests/quotes-pdf.test.ts` – the PDF is parsed back with pdf.js: Dutch/English, totals, many lines and page breaks (header repeat, margins),
  very long descriptions, special characters and unsupported glyphs, optional content, determinism.
* `tests/rls-quotes.integration.test.ts` (real local Supabase, in `npm run test:rls`) – anon and non-admin denied on every table and
  function, numbering (sequential, concurrent, year rollover, rollback), transitions and locking, delete rules, no cascade from prospects,
  snapshots, duplicate, activity log, settings/templates.

## Not built

Deliberately **not** part of this milestone, and not started without explicit approval:

* **Invoicing / accounting / payments.**
* **Sending quotes.** No quote is emailed by the app. Future *"Send quote via Zoho"* would need a write scope (`ZohoMail.messages.CREATE`);
  the Zoho connection stays read-only today.
* **Public quote links, online accept/reject, signatures.** A future version would add a signed, expiring, single-quote token page (no
  predictable URL), an accept/reject form that writes `accepted_at` / `rejected_at` with the client's name and IP, and an audit entry. Until
  then acceptance is recorded by hand ("Mark accepted").
* Quote versioning, CSV/XLSX export of quotes.
