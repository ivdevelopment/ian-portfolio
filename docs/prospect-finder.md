# AI Prospect Finder (P10)

`crm.ianverlinden.com/prospecting` ("Find prospects") finds businesses that are likely to need Ian's services, qualifies them with transparent
evidence, and lets a person review each one before anything reaches the CRM. It is a sales/CRM feature and is independent of the future invoicing work.

**State at the end of P10:** schema, page, pipeline and provider boundary are built and tested; the AI provider is **disabled**
(`AI_PROSPECTING_PROVIDER` unset). No AI request, no billable API call and no fake candidate can happen. Real AI is blocked on OpenAI's approval (see §5).

## 1. Audit of what already existed (and what is reused)

| Area | Existing | Used by P10 |
| --- | --- | --- |
| Prospect schema | `prospects` (company, sector, city, website, email, phone, status, priority, source…), `prospect_activities` (typed, append-only) | Same table; same activity timeline |
| Creation rules | `validateProspectForm` + `toProspectRow` (`src/lib/schemas/prospect.ts`) used by the New prospect form | "Add prospect" calls exactly these, so validation is identical |
| Duplicate rules | `src/lib/prospects/duplicates.ts` (company/email/website keys, matching only, nothing merged) | `normalizeCompany`, `normalizeEmail`, `websiteHost` are reused in `dedupe.ts` |
| Source convention | free text, e.g. `Zoho outreach`, `Import: <file>` | `AI prospecting` |
| Candidate pattern | Zoho mail candidates (`mail_prospect_candidates`): proposed by a sync, decided by a person, auditable Ignore, atomic claim | Same shape: candidate table, atomic claim, auditable ignore |
| External requests | preview gateway SSRF layers (`target-url.ts`, `ip-safety.ts`, `safe-fetch.ts` safe lookup) | `validatePublicUrl` reuses the hostname rules; the dial goes through the same connection-time address check |
| Host routing, auth, noindex | CRM host tree under `src/app/(crm)/crm`, `requireAdmin` | the page is `(app)/prospecting`, no new route logic needed |
| Loading UX | route skeletons, `usePendingAction`, `Button pending` | reused |

Not duplicated: no second prospect-creation path, no second duplicate engine, no second SSRF implementation.

## 2. Pipeline

```
Provider web search  OR  public BusinessSource
        ↓  RawBusiness[]
dedupe (CRM prospects, ignored candidates, cooldown, within the batch)
        ↓
website analysis (deterministic: HTTP, https, viewport, contact/CTA/booking/quote/gallery, footer year, legacy markup, CMS, social)
        ↓  small dated observations, no page archive
qualification (ProspectAIProvider) -> validated score (scoring.ts)
        ↓  threshold (default 70, per run)
prospect_discovery_candidates (status pending)
        ↓  human review
Add prospect (CRM creation rules)  |  Ignore (auditable)
```

* Code: `src/lib/prospecting/{pipeline,analyze,public-fetch,robots,dedupe,scoring,service,config}.ts`, providers in `providers/`.
* A run is started by a server action and executes after the response (`after()`); the page polls the run row, so the progress shown is the real stage and
  real counters (found / already known / analysed / candidates so far), never a percentage. Candidates are written per batch of 5, so strong ones appear while the run goes on.
* One failing website (unreachable, blocked by robots.txt, crash) is recorded as a note and the run continues. If the provider stops midway the run is `partial` and keeps what it found.
* The run stops as soon as the requested number of candidates above the threshold is reached (saves usage). Only one run at a time.

## 3. Qualification

Score (0–100, a prioritisation aid, not a measurement): business fit 25, website need 25, conversion gap 15, service opportunity 15, local relevance 10, contactability 10.
Per category the breakdown stores the points, a written reason and the observation ids it rests on. Rules enforced in code, whatever a provider returns:

* every category is capped at its maximum; nonsense values become 0;
* **website need** and **conversion gap** points need at least one existing observation; otherwise they are removed (a claim cannot raise the score on its own);
* **contactability** is computed from facts (email 6, phone 2, contact page 2), never taken from the provider;
* reasons with opinionated wording ("terrible", "ugly"…) are replaced by a neutral line; summaries/opportunities likewise;
* only evidence a reason cites is kept on the candidate.

Observations are neutral and dated: `{ id, url, title, fact, at }`, e.g. "No booking or reservation link was found on the pages checked (3 pages checked)". Absence is never phrased as non-existence.
Visual taste alone is never a signal. No Lighthouse-style numbers are claimed.

## 4. CRM behaviour

* **Add prospect**: atomic claim `pending → added` (double click = one prospect), live re-check against the CRM (a prospect added since the run → "Already in the CRM", candidate becomes `rejected_duplicate`),
  then the same validation/row mapping as the New prospect form with `status = researching`, `priority = normal`, `source = "AI prospecting"`. **Never Contacted.** Only verified fields are copied
  (company, website, email, phone, city, sector). Activity: *Prospect discovered* with the score and top reason. The candidate row stays untouched afterwards and is shown on the dossier as **Discovery insight** (score, suggested service, breakdown, evidence).
* **Ignore**: `status = ignored`, `ignored_at`, who and a note; the domain and email are never proposed again. Nothing is deleted; restoring is a status change (no screen yet).
* **Duplicates** (deterministic, in order): exact email → website domain (www/scheme/path normalised; also a prospect whose own email is at that domain unless it is a shared provider) →
  company name + locality (both present). No fuzzy/AI merging. Duplicates are listed separately as "Already in the CRM" for the latest run.
* **Cooldown**: `COOLDOWN_DAYS = 60` per domain, whatever the outcome (candidate, below threshold, unreachable…), remembered in `prospect_discovery_seen`. Switch off per run with "Skip businesses already researched".
* A discovery run never changes an existing prospect.

## 5. OpenAI: what is possible today (verified 5 Nov 2026 against developers.openai.com/siwc)

* ChatGPT plan usage is documented for **open-source and locally hosted apps**. For "a paid or remotely hosted app" the docs say to complete OpenAI's interest form; it is described as available to **"selected private clients"**.
  There is **no self-serve approval and no published criteria**; whether a single-user private CRM on Vercel counts is not defined.
* A hosted app needs a registered OAuth client (an `oaiapp_…` client ID) and an exact registered callback URL per environment; the open-source path (dynamic client registration, loopback redirect on 127.0.0.1) does not apply to a hosted server.
* The contract (documented only, not implemented): OpenID Connect + PKCE (S256) against `https://auth.openai.com`; scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`,
  resource `https://api.openai.com/v1`; Responses API with `store: false`, `stream: true`, without temperature/max_output_tokens/metadata, file search, code interpreter or hosted MCP;
  access token 1 h, refresh token 30 days and rotating; usage limit = HTTP 429 `subscription_sharing_usage_limit_exceeded` (no fallback billing path).
* Web search through plan usage is neither listed as supported nor forbidden ("subject to model and account policy"): the provider reports `supportsWebSearch = false` until proven.
* Token storage on a multi-user hosted server is **not stated** (the docs say tokens belong in protected local/self-hosted runtime storage and never in browser JavaScript, logs or source control). A server-side encrypted store like the Zoho one would be the natural design, but this needs OpenAI's confirmation.
* Plan usage "does not grant access to their ChatGPT conversations or other account context". Memories and files are not mentioned; this feature neither needs nor requests them.
* Contradictions between pages exist (authorization endpoint spelling; interest form vs "contact your OpenAI representative"); the discovery document at `https://auth.openai.com/.well-known/openid-configuration` is the authority and was not fetched because nothing is implemented.

**Exact blocker:** OpenAI must approve this app as a selected private client (interest form → client ID + registered callback). Until then `chatgpt_plan` cannot be connected and the Finder stops at the provider boundary.
Nothing was attempted around this: no cookies, no personal token, no undocumented endpoint, no API key. **No normal OpenAI API billing is used or added** (`OPENAI_API_KEY` is not read anywhere; a test fails if it appears in `src/lib/prospecting`).

## 6. Provider abstraction and the flag

```
AI_PROSPECTING_PROVIDER = disabled | mock | chatgpt_plan      (default and fallback: disabled; no fallback chain)
```

* `disabled`: the page explains "AI prospecting is not connected yet…", no Find button, `startDiscoveryAction` refuses before any row or request.
* `chatgpt_plan`: `ChatGPTPlanProvider` reports `available: false` with the blocker and throws `ProviderUnavailableError`; the pipeline stops there and never tries another provider.
* `mock`: deterministic, invented businesses (`(sample data)`, `.invalid` domains, `synthetic = true`, pages served from memory). Only allowed outside production or against a **local** database; against the hosted database it is refused.
* Contract (`providers/types.ts`): `capabilities()` (incl. `supportsWebSearch`), optional `discoverBusinesses()`, `qualifyBusinesses()` returning proposals that `scoring.ts` validates. No CRM component sees an auth detail.
* No public `BusinessSource` is built: there is no legitimate keyless search API to rely on. When the provider cannot search the web, a source adapter (public directory / search API with its own terms) is the next step.

## 7. Security and data handling

* **SSRF** (`public-fetch.ts`): http/https only; no credentials; ports 80/443 only; public DNS names only (no IP literals in any notation, no localhost/internal suffixes); the dialled address must be public (DNS-rebinding safe lookup);
  redirects followed by hand, max 4, every hop re-validated (a redirect into a private network is refused before it is dialled); 8 s timeout, 600 KB cap, HTML only; one request at a time per site with a 250 ms pause.
* **Politeness**: `robots.txt` is read and respected (our own group, longest match); a site that disallows the homepage is not analysed; at most the homepage plus contact/services/about (4 pages); identifiable user agent; no login, CAPTCHA, private API or paid database.
* **Retention**: only URL, title, a short fact, timestamp, the score and its reasons. Pages are never archived.
* **RLS**: `prospect_discovery_runs`, `_candidates` and `_seen` are admin-only; `anon` has no grants. Nothing here is on the public site.
* **No outreach**: nothing emails, calls, DMs or submits a contact form. Human review is mandatory for every candidate.
* **GDPR**: business-relevant public information only; contact details limited to professional email/phone found on the business's own pages or listing.

## 8. Not built (documented)

* Real AI provider and the Settings "Connected / Manage usage / Disconnect" UI (needs the approval above; the Settings panel shows the state and the plain reason).
* A public-search source adapter, and web search through the provider.
* P10.x: dashboard card ("5 waiting for review"), restoring ignored candidates, outreach **drafting** (never sending) with the same provider, proximity sorting by real distance.
