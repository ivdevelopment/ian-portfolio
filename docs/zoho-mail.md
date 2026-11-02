# Zoho Mail integration (P7B foundation)

**Status: built, tested with mocks, switched OFF.** Nothing is connected, no Zoho credential exists for this app, and no mail is read. The CRM and the website behave exactly as before whether or not this is configured, and keep working if Zoho is down.

## Audit (official Zoho documentation)

| Question | Answer | Source |
| --- | --- | --- |
| Data center | **EU.** MX is `mx.zoho.eu`, the existing SMTP host is `smtppro.zoho.eu`. | DNS, `.env.example` |
| Authorization endpoint | `https://accounts.zoho.eu/oauth/v2/auth` (`response_type=code`, `access_type=offline`, `prompt=consent`, `state`) | [OAuth guide](https://www.zoho.com/mail/help/api/using-oauth-2.html), [multi-DC](https://www.zoho.com/accounts/protocol/oauth/multi-dc.html) |
| Token endpoint | `POST https://accounts.zoho.eu/oauth/v2/token` (`authorization_code` and `refresh_token` grants). Revoke: `POST …/oauth/v2/token/revoke?token=` | same |
| Client type | **Server-based Application** in the Zoho API Console (accounts.zoho.eu), authorization-code flow | OAuth guide |
| Callback URL | `https://ianverlinden.com/admin/settings/integrations/zoho/callback` (must be registered exactly) | OAuth guide |
| Scopes (least privilege) | `ZohoMail.accounts.READ` (find the account id) and `ZohoMail.messages.READ` (search/list). **Not requested:** folders (a `ZohoMail.folders.READ` scope is not documented; the sync searches across the mailbox instead), organization/admin scopes, `ZohoMail.messages.CREATE` (only for sending, later). | API pages |
| Token lifetimes | Authorization code 2 min, one use. Access token 1 h. Refresh token long-lived until revoked; whether it is re-issued on refresh is not documented. | OAuth guide |
| API host | Documented as `https://mail.zoho.com/api/…`. For the EU the same path on **`https://mail.zoho.eu`** is the expected host but is **not stated in the docs I could read**: it is configurable (`ZOHO_MAIL_API_URL`) and the first approved connection test (`GET /api/accounts`) proves it. | API pages |
| Auth header | `Authorization: Zoho-oauthtoken <access_token>` (not `Bearer`) | API pages |
| Message listing | `GET /api/accounts/{accountId}/messages/view` (needs `folderId`) and `GET …/messages/search?searchKey=…&start=&limit=` (limit max 200). Entries carry `messageId`, `threadId`, `folderId`, `fromAddress`, `toAddress`, `ccAddress`, `subject`, `summary`, `receivedTime`, `sentDateInGMT`. | [List](https://www.zoho.com/mail/help/api/get-emails-list.html), [Search](https://www.zoho.com/mail/help/api/get-search-emails.html) |
| Search syntax | `fromDate:DD-MMM-YYYY`, `toDate:`, `sender:`, `to:`, `cc:`, `subject:`, combinable with `::` (AND) and `:or:`. There is no `from:` operator. | [Search syntax](https://www.zoho.com/mail/help/search-syntax.html) |
| Incremental sync | **No push, webhook or change feed exists** in the Mail API. Incremental = search by `fromDate` (a "since" filter) from the last sync day, with one day of overlap, deduplicated by message id. | API index |
| Threads | No "get thread" call; list entries have `threadId`, and the list API accepts `threadId`. | API index |
| Sending | `POST /api/accounts/{accountId}/messages`, reply `POST …/messages/{messageId}` (scope `ZohoMail.messages`). Not built: phase P7B.4. | API index |
| Rate limits | **Not published** in the pages I could read (no 429 in the documented response codes). Treated defensively: sequential requests, 200-message pages, back-off on 429 / "too many" answers, hard caps, manual sync only. | response-codes page |
| Does Mail Lite include API access? | **Unknown / not documented.** No official page ties the REST API to a plan. The only way to know is to try a read-only call on the real account (`GET /api/accounts`). If Zoho refuses, the dry run reports it and nothing else changes. | none found |

## Design

- **Official REST API only.** No scraping, no undocumented endpoints, no browser automation.
- **Feature boundary.** `ZOHO_MAIL_ENABLED=1` plus client id/secret and an encryption key are all required; otherwise Settings → Integrations says "not enabled" and no mail table is read. The existing SMTP inquiry notification (`src/lib/email`) is untouched.
- **Token storage.** The refresh token is stored in `mail_connections.refresh_token_encrypted` as **AES-256-GCM** ciphertext (`v1.<iv>.<tag>.<data>`); the key (`ZOHO_TOKEN_ENCRYPTION_KEY`) exists only in the server environment (Vercel env var), so a database leak or an admin API read yields nothing usable. Access tokens live in process memory only. The OAuth `state` is an HMAC-signed, httpOnly, 10-minute cookie bound to the admin, compared with the `state` parameter. RLS: admin only, `anon` has no grants. Tokens never reach browser JavaScript.
- **Read-only sync, manual only.** Settings → Integrations → Zoho Mail: *Connect*, *Check mailbox (dry run)*, *Sync now*, *Reconnect*, *Disconnect*. The dry run searches a 30-day window, stores nothing and shows counts. *Sync now* stores metadata of messages whose participants match a prospect. No scheduled job exists.
- **Matching.** Exact, normalised email address. An incoming message belongs to its sender, an outgoing one to its first matching recipient (to, then cc). Your own address never matches, an address shared by two prospects matches neither, and nothing is fuzzy.
- **Storage.** `mail_messages`: addresses, subject, a ≤500-character **plain-text** snippet, timestamps, direction, provider ids. Unique on (connection, provider message id), so re-running never duplicates. No bodies, no attachments, no HTML. Mail is rendered next to CRM activities on the prospect page but never copied into `prospect_activities`.
- **HTML safety.** HTML is reduced to text (scripts, styles, comments, all tags, so tracking pixels and links vanish; escaped markup is stripped again after decoding) and rendered as text.
- **Replies.** The prospect page shows "New reply detected" with a **Mark as Replied** button (the existing action). The status is never changed automatically.
- **Disconnect** revokes the token at Zoho, deletes it, and removes the copied mail (cascade).

## Phases

1. **P7B.1 Connect OAuth**: built, off.
2. **P7B.2 Read-only sync (dry run, then manual)**: built, off.
3. **P7B.3 Prospect timeline**: built; appears only when mail is linked.
4. **P7B.4 Send / reply**: **not built.** Needs the extra `ZohoMail.messages.CREATE` scope and a separate approval.

Future automation options (not built): Vercel Cron calling a protected sync endpoint (simplest, polling); a mailbox rule forwarding to an inbound webhook; nothing push-based exists in the Mail API. Old notes such as "Getoond in Zoho Drafts; verifieer of bericht in Verzonden staat." are never rewritten automatically; once read-only sync is approved they can be verified by hand against the synced mail.

## Turning it on (needs the owner's explicit approval)

1. Apply migration `20261102000000_zoho_mail_foundation.sql` to the hosted database.
2. In the Zoho API Console **for the EU data center** (`https://api-console.zoho.eu`), create a **Server-based Application** with redirect URI `https://ianverlinden.com/admin/settings/integrations/zoho/callback`; note the client id and secret.
3. In the Vercel project `ian-portfolio` (Production), set `ZOHO_MAIL_ENABLED=1`, `ZOHO_DATA_CENTER=eu`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` (sensitive), `ZOHO_TOKEN_ENCRYPTION_KEY` (sensitive, `openssl rand -base64 32`), optional `ZOHO_MAILBOX`; redeploy.
4. Settings → Integrations → **Connect Zoho Mail**, approve the two read scopes while signed in as `hello@ianverlinden.com`.
5. **Check mailbox (dry run)** first and review the matches, then **Sync now**.

## Prospect candidates (manual sync, reviewed by a person)

**What the sync reports.** "Sync now" only ever *stores mail that matches a prospect's exact email address* and *proposes* the rest. Its result
uses five different words, and none of them means a prospect was created:

| Label | Meaning |
| --- | --- |
| New emails | messages stored by this run (they matched a prospect) |
| Matched prospects | how many different prospects those messages belong to |
| Prospect candidates | outgoing recipients nobody has yet, found by this run, waiting for a decision |
| Prospects created | always 0 for a sync: only **Add as prospect** creates one |
| Unmatched messages | every message that matched no prospect (incoming mail, internal mail, tests, candidates...): information only, never stored |

**What was ambiguous before.** The old result showed `Unmatched` and (in the dry run) `candidate: <Company>`; the latter was a suggestion that an
unmatched address belongs to an *existing* prospect (same website / domain name) and had nothing to do with a new prospect. It now reads
"possible existing prospect". Nothing in the sync ever inserted a prospect.

**Candidate rules** (`src/lib/mail/zoho/prospect-candidates.ts`). A recipient is proposed only when the message is outgoing, the address is on the
To line (not Cc), no prospect has that exact address (and it is not shared by two prospects), it is not your own address or domain, not a
no-reply/bounce/test address or reserved test domain, the subject is not a test, there are at most 5 recipients, and the address was not
ignored or added before. Incoming mail never creates a candidate. Only mail inside the sync window is considered; history is never scanned.

**Storage** (`mail_prospect_candidates`, additive, admin-only RLS): one row per (connection, recipient address) with the pending outgoing
messages (at most 20). A repeated sync adds only provider ids not seen before, so nothing is duplicated.

**Decisions** (the review list in CRM Settings → Email; the sync result links to it):

* **Add as prospect**: claims the candidate atomically (a double click or two tabs create one prospect), then creates a prospect with `status = contacted`,
  `priority = normal`, `email` = the exact recipient, `source = "Zoho outreach"`, first/last contact = the Brussels day of the first/last message, and the
  activity *First contact sent* ("Created from unmatched outgoing Zoho mail after manual review: <subject>"). The company name is the recipient's display
  name, else the domain (garage-heyrick.be → Garage Heyrick), else the address itself, and is editable before adding. No city, phone, website, sector or value
  is invented. If a prospect with that exact address already exists the candidate links to it instead of creating a second one. The pending messages are then
  stored once in `mail_messages` (the provider message id stays the idempotency key, an id that is already stored is skipped), so the dossier shows them at once and
  the next sync finds them already stored.
* **Ignore**: an auditable decision, not a deletion. The row becomes `ignored` with `ignored_at`, `decided_by` and a `decision_note`; the address, the provider message
  ids and their metadata (subject, times, folder, recipients) are kept so the dedup and the reason it no longer appears stay explainable; only the snippets are
  dropped and no body is ever stored. The address is never proposed again. Nothing in Zoho is touched and mail already linked in the CRM stays. Restoring a
  candidate later is `status = 'pending'` (no screen for it in this milestone). A sync that raced with the decision cannot revive it (decided rows are never overwritten).

Unchanged: read-only Zoho scopes, nothing is sent, manual sync only, encrypted tokens, existing RLS.
