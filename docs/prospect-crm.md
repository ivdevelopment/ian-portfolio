# Prospect CRM (`/admin/prospects`)

The admin's single source of truth for website-sales prospects. Private, admin-only, no public surface.

## Architecture

| Layer | Where |
| --- | --- |
| Schema, triggers, RLS, summary function | `supabase/migrations/20261101000000_prospects_crm.sql` |
| Vocabulary (statuses, priorities, activity types) | `src/lib/prospects/constants.ts` |
| Calendar-day maths (Europe/Brussels) | `src/lib/prospects/dates.ts` |
| List state in the URL, filters, search | `src/lib/prospects/filters.ts` |
| Server reads (list, detail, timeline, summary) | `src/lib/prospects/queries.ts` |
| Server actions (CRUD, quick actions, bulk, links, convert) | `src/app/(admin)/admin/(panel)/prospects/actions.ts` |
| Import (CSV/XLSX) | `src/lib/prospects/import*.ts`, `…/prospects/import/api/route.ts`, `src/components/admin/prospect-import.tsx` |
| Export (CSV/XLSX/JSON) | `src/lib/prospects/export.ts`, `xlsx.ts`, `…/prospects/export/route.ts` |
| One-time legacy migration | `scripts/prospects-legacy/` |

Pages: list `/admin/prospects`, `/new`, detail `/[id]`, edit `/[id]/edit`, `/import`. The dashboard has a compact "Sales follow-ups" panel.

## Data model

- `prospects`: company, sector, city, website, email, contact, phone, `status`, `priority`, `first_contact_on`, `last_contact_on`, `next_follow_up_on`, `estimated_value_eur`, `quote_value_eur`, `contact_delivery_status`, `source`, `notes`, `linked_project_id`, `linked_preview_id`, `legacy_ref` (idempotency key of one-time imports).
- `prospect_activities`: append-only history (`type`, `title`, `description`, `occurred_on`, optional `occurred_at`, `metadata`). Deleted with its prospect.
- `prospect_imports`: audit trail of every import/migration (parsed / imported / skipped / duplicates / warnings).
- **Dates are calendar days** (`date`, a day in Europe/Brussels). The source tracker only knows days, so no time of day is invented. Follow-up arithmetic never depends on the server's time zone.
- **Derived, never stored:** "days until follow-up", overdue / due-today / upcoming, pipeline value.
- `last_activity_on/title` are trigger-maintained so the list never loads timelines. `status_order` / `priority_order` are generated sort keys (pipeline order, not alphabetical).
- `contact_delivery_status` (`confirmed` / `needs_verification` / `unknown`) keeps the legacy "Verzending bevestigd?" flag. It can be dropped later if it stops being useful.

## Pipeline

`new → researching → ready_to_contact → contacted → follow_up_due → replied → interested → concept_sent → meeting_planned → quote_sent → won`, plus `lost`, `not_interested`, `no_response`.

- *Closed*: won, lost, not interested, no response. A follow-up on a closed prospect is never "overdue".
- *Replies* (the prospect responded): replied, interested, concept sent, meeting planned, quote sent, won.
- *Active opportunities*: replied … quote sent (responded and still open).
- **A passed date never changes a status.** An overdue follow-up is shown ("Overdue 2 days") next to the unchanged status.

## Activity timeline

The database writes "Prospect created" and every status change (old and new status in `metadata`). The app adds follow-up scheduled / rescheduled / cleared / completed, linked / unlinked preview or project, project created from prospect, and manual entries (note, contact, reply, concept, meeting, quote). One-time migrations (`legacy_ref`) bring their own history instead of a made-up "created today" event.

## Pipeline value, honestly

Pipeline value = estimated value of **open** prospects that **have** one. A blank estimate is not €0 and is not counted; closed prospects are not pipeline. Quote total excludes lost / not interested / no response. Won value = quotes of won prospects.

## Import and export

- **Import:** CSV (`,` `;` or tab) or XLSX, ≤ 5 MB / 2,000 rows. Upload → parse → map columns (Dutch and English headers are recognised) → validation errors and likely duplicates → confirm. Duplicates (same normalised company, email or website host, against the CRM and within the file) are skipped unless you tick "Import anyway"; **nothing is ever merged**. Unknown statuses are errors, never guesses. Every import writes a `prospect_imports` row. PDFs are not an import format.
- **Export:** CSV / XLSX / JSON for all, the current filtered results, or the selection. XLSX has `Prospects` and `Activities` sheets with real dates and numeric euro cells; JSON can nest activities; activity history is never packed into one CSV cell. Generated server-side by a POST route that requires the admin session and a same-origin request (no public or guessable URL). CSV/XLSX text starting with `=`, `+`, `-`, `@` (or tab / CR) is prefixed with `'` so a spreadsheet cannot run it.

## Security

RLS on all three tables; `anon` has no grants at all; policies require `is_admin()`. Covered by `tests/rls-p6.integration.test.ts` (anon and signed-in non-admin are denied on every table and on `prospect_summary`). Deleting a prospect cascades to its activities only: linked previews and projects are never touched (`ON DELETE SET NULL` in the other direction too).

## Convert to project

Explicit button only. Marks the prospect won and creates an **unpublished** project draft (title, client, category from the sector, live URL from the website) linked back. The projects table requires a short description, so the draft carries a clearly marked placeholder. Nothing is published and no content is invented.

## Legacy tracker migration (one time)

`scripts/prospects-legacy/` rebuilds the 35 rows of `Website_Prospect_CRM - Prospects.pdf` (a column-blocked print-out), maps them exactly (Gecontacteerd → contacted, Reactie ontvangen → replied, Normaal → normal, Ja / Controleer / blank → confirmed / needs_verification / unknown, dates and notes verbatim) and imports them in one idempotent statement keyed by `legacy_ref`. The parsed JSON holds real business contacts, so it is git-ignored.

```bash
npm i --no-save pdfjs-dist@4.10.38
node scripts/prospects-legacy/parse-pdf.mjs "<path to the PDF>"
node scripts/prospects-legacy/import.mjs                 # dry run: report only
node scripts/prospects-legacy/import.mjs --apply local   # or: --apply linked
```

If exactly one migrated "Geert Kips" prospect and one preview with subdomain `geertkips` exist, the import links them (the preview itself is never modified).

## Not built (extension points)

Zoho Mail sync and sent / reply detection, email templates and scheduled outreach, lead scoring, a Kanban board, quote generator, invoicing, customer portal. The schema leaves room: `prospect_activities.metadata` (jsonb) can hold message ids; `contact_delivery_status` can be fed by mail sync; `source` and `legacy_ref` already identify where a record came from. Email automation is deliberately out of scope: the CRM tracks outreach, it does not send it.
