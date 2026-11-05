# Local Prospect Agent (P10.1)

The Prospect Finder (P10) needs an AI step to judge businesses. Instead of the OpenAI API (billed) or a hosted ChatGPT integration (not approved for
this app, see `docs/prospect-finder.md` §5), that step runs **on Ian's own Windows PC**, in **Codex CLI signed in with the ChatGPT plan**. The CRM
only queues the work; a small program on the PC picks it up and sends the result back.

```
crm.ianverlinden.com ── Find prospects ──▶ queued run (Supabase)
                                                ▲  │
              outbound HTTPS only (PC → CRM)    │  ▼
LOCAL WINDOWS AGENT ◀──── claim / progress / result / fail ────  /api/prospect-agent/*  (main app only)
   │  discovery (OpenStreetMap) + deterministic website checks + P10 dedupe/cooldown
   └─ codex exec (read-only, schema-constrained)  ──▶ ChatGPT plan
                                                         │
CRM candidate review (unchanged P10) ◀── validated candidates
```

* The CRM **never** connects to the PC: no port, no tunnel, no firewall rule, no listening socket in the agent.
* **No** `OPENAI_API_KEY`, **no** OpenAI SDK, **no** ChatGPT/Codex endpoint is called by this code (a test fails if one appears). Codex CLI owns
  authentication and its own network access; the agent only starts the official binary.
* Codex credentials stay in Codex's own storage on the PC. They are not read, copied, forwarded, stored in Supabase or sent to Vercel.

## 1. Pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Queue | `prospect_discovery_runs` (P10 table, extended) | `queued → claimed → discovering → analyzing → qualifying → completed / partial / failed / cancelled`, a **lease** (`agent_id`, `lease_expires_at`, `heartbeat_at`, `attempts`), `cancel_requested`, a sanitised `failure_kind`, a short `events` trail |
| Device | `prospect_agents` | one row per registered PC: name, token **hash**, last seen, Codex version/state. One active device at a time (personal CRM) |
| Database functions | `agent_heartbeat / agent_claim_run / agent_progress / agent_context / agent_run_params / agent_submit / agent_fail` | the *only* thing the agent API can do. Each re-checks the token, the run's owner and the lease |
| API | `POST /api/prospect-agent/{heartbeat,claim,context,progress,result,fail}` | main application only; 404 on the CRM host and on `preview-gateway`; bearer token only; body ≤ 1.5 MB; 120 requests/min per token |
| Worker | `tools/prospect-agent/` | claims a run, discovers, checks websites, asks Codex, submits the result |
| CRM | Find prospects, Settings → Local Prospect Agent | queue a search, see progress, cancel, set up / revoke the device |

The worker reuses P10's code directly (`src/lib/prospecting`: pipeline, website analysis, SSRF-safe fetch, robots.txt, dedupe, cooldown, scoring). It
is a separate program (`tools/prospect-agent`), not part of the Next.js bundle.

## 2. Security model

* **Connection token**: `ipa_` + 256 random bits, shown **once** in Settings, stored server-side only as a SHA-256 hash (the column is not even
  readable by the admin role). Generating a new token **revokes the old device**; *Revoke device* stops the token at once (every function checks the
  row). On the PC it is stored with **Windows DPAPI for the current user** (ciphertext in `%LOCALAPPDATA%\IanProspectAgent\token.dpapi`; the secret is passed to
  PowerShell on stdin, never as an argument, and never logged).
* **No Supabase key on the PC and none on Vercel.** The API calls the database functions with the public (anon) key; the functions are `SECURITY DEFINER`,
  can do nothing but the operations above, and the helper that resolves a token is not callable at all. The CRM's admin RLS is untouched.
* **The server never trusts a result** just because the token is valid: every candidate is re-validated (`src/lib/prospecting/agent/validate.ts`): category
  maximums, the total, the **run's own** minimum score, evidence for website-need/conversion points, contactability vs the contact details found, neutral
  wording, public http(s) URLs only, no sample data. Rejects are counted and dropped. The database then skips businesses the CRM already has (same email or
  website host, or an existing candidate) whatever the worker says.
* **Minimum data to the PC and to Codex.** The worker receives business facts and *hashes* of prospect emails (never a raw email, note, mail or quote).
  Codex receives only the search settings and compact evidence per business (signals, dated observations, whether an email/phone exists) and is told to run no
  commands. Its answer is untrusted: schema-checked on the PC, re-validated by P10's scoring, re-validated by the server.
* **Codex runs narrowly**: `codex exec --sandbox read-only --skip-git-repo-check --output-schema … -` in a throwaway folder
  (`%LOCALAPPDATA%\IanProspectAgent\runs\<run-id>\`, deleted after the run, old ones pruned), prompt on **stdin**, arguments as an **array** (no shell string; on Windows the
  `.cmd` shim goes through `cmd.exe` as one verbatim, quoted command line and any metacharacter is refused), an allow-listed environment (no token, no Supabase
  key), stdout/stderr/result size caps, a timeout with the whole process tree killed, one Codex process at a time. No `--search`, no `--yolo`.
* **Never logged**: tokens, Codex credentials, request bodies, private notes. The local log keeps run id, stage, counts, durations and Codex exit codes
  (`%LOCALAPPDATA%\IanProspectAgent\logs\agent.log`, rotated at 1 MB).

## 3. Setup (Windows)

1. **Install Codex CLI**: `npm install -g @openai/codex` (or the Windows installer from the Codex documentation).
2. **Sign in**: run `codex` and choose **Sign in with ChatGPT**. Check with `codex login status`.
3. **Install the agent** (in the project folder): `npm install`, then `npm run prospect-agent -- setup`. It asks for the CRM address (default
   `https://ianverlinden.com`; plain `http://` only for localhost) and the connection token.
4. **Connect**: in the CRM go to **Settings → Local Prospect Agent → Generate connection token**, copy it (shown once) and paste it into `setup`.
5. **Test Codex**: `npm run prospect-agent -- test-codex` runs a tiny structured prompt (`{"ok": true}`, no research) and proves install + ChatGPT sign-in + headless exec + structured output.
6. **Run**: `npm run prospect-agent -- start`. Ctrl+C finishes the current step, reports what it has, and exits (press it twice to force).

Other commands: `status` (configuration and Codex readiness), `doctor` (Codex's own read-only `codex doctor --summary` plus this agent's checks; nothing is repaired),
`forget` (removes the stored token from this PC). Autostart is **not** enabled; launch it manually. Later this can become a packaged `.exe` or a scheduled
task without changing the architecture.

Settings (`%LOCALAPPDATA%\IanProspectAgent\config.json`, overridden by environment variables):

| Setting | Env | Default |
| --- | --- | --- |
| CRM address | `PROSPECT_AGENT_URL` | `https://ianverlinden.com` |
| Codex executable | `CODEX_BIN` | `codex` |
| Model | `CODEX_PROSPECT_MODEL` | Codex's own default for your plan (nothing is hard-coded) |
| Reasoning effort | `CODEX_PROSPECT_EFFORT_QUICK` / `_DEEP` | `medium` for Quick Find, `high` otherwise |
| Poll interval | `PROSPECT_AGENT_POLL_SECONDS` | 5 s while idle |

At start the agent runs `codex --version`, **reads the installed `codex exec --help`** and requires `--output-schema`, `--sandbox` and `--skip-git-repo-check`; optional flags
(`--output-last-message`, `--ephemeral`, `--model`, `--cd`, `--color`) are used only if that version lists them. It reports `ready`, `not_installed`, `not_authenticated`
(`codex login status` exit code) or `error` with the version in every heartbeat, and it does **not claim work while Codex cannot run**, so the run stays queued and the CRM says why.

## 4. A search, step by step

`Find prospects` (the finder only shows the button while a device is online and its Codex is ready) creates a **queued** run and returns at once. The agent:

1. polls every ~5 s (exponential backoff 5 s → 2 min on errors), **claims** the oldest queued run (atomic, `FOR UPDATE SKIP LOCKED`: two workers can never own one run) with a 90 s **lease**;
2. sends a heartbeat every 20 s and renews the lease with a progress call at every step and every 25 s (so a long Codex call never loses it);
3. **discovers** businesses (OpenStreetMap, below), drops what the CRM already knows (by hashed email, website domain, name + locality), ignored businesses and the 60-day cooldown;
4. **analyses** websites deterministically (HTTP, https, viewport, contact/CTA/booking/quote/gallery, footer year, legacy markup; robots.txt respected; ≤ 4 pages per site);
5. asks **Codex** to qualify the plausible ones, in batches of 6 (one Codex process at a time), stopping as soon as enough candidates pass the threshold;
6. checks for **cancellation** between steps, and for its **time budget** (Quick 10 min, Deep 30 min; a Codex call is limited to 6/10 min);
7. submits **one** result: candidates, duplicates, the cooldown memory, counters, Codex calls and duration. A crash before that leaves nothing half-written: the lease expires, the run returns to the queue (up to 3 attempts), then fails.

Progress shown in the CRM is real: `Queued → Picked up by Ian-PC → Finding businesses… → Checking duplicates… → Analyzing N websites… → Qualifying candidates… → N strong prospects found`. **Cancel run** stops a queued run at once
and an active one between steps, keeping the candidates already found. Review, Add prospect (Researching, never Contacted) and Ignore are the unchanged P10 flow.

### Discovery source (OpenStreetMap) — Overpass, now only the fallback

*Since P10.2 the preferred source is the local Belgium index described in the next section; what follows is the public Overpass source, used only as an explicitly enabled fallback.*

P10 had no business source, so P10.1 adds one that is public, legal to query and keyless: **OpenStreetMap via Nominatim (geocoding Brugge is built in) and Overpass**, one polite request each with an identifying `User-Agent`.
It reads only the tags a business chose to publish (name, website, phone, email, social pages), skips chains (`brand` tag) and dedupes by name + city. **Coverage depends on mapping volunteers**, so it is a starting list, not a directory.
The public Overpass servers are shared and sometimes at capacity (HTTP 502/504), so the agent tries three mirrors, pauses between rounds, and gives up after 3 minutes with the dedicated failure kind **`source_error`**
("The public business source (OpenStreetMap) is busy or unreachable. Try again in a few minutes."), never blaming Codex. A search-engine or directory adapter can replace it behind the same `BusinessSource` interface.
Codex is **not** asked to browse: deterministic discovery and website checks stay authoritative; Codex only judges the evidence. (Whether Codex's web search is available under the plan was not assumed and is not used.)

### Local business data (P10.2): the preferred discovery source

Public Overpass servers were too unreliable for a search that must start within seconds, so discovery now reads a **local copy of the Belgian OpenStreetMap extract** (Geofabrik `belgium-latest.osm.pbf`) kept on the agent PC.
Overpass is only a fallback (below). The local data never goes to Vercel, Supabase or Git; only the normalised candidates a run finds reach the CRM.

**Install and update** (run on the PC, not part of a search; the extract is never downloaded per search):

```bash
npm run prospect-agent -- update-business-data          # first install, or refresh when Geofabrik has a newer extract
npm run prospect-agent -- update-business-data --force  # rebuild the index from the extract already on disk
npm run prospect-agent -- discover --location Brugge --area "Brugge + 30 km" --count 5   # dry run: no Codex, no CRM, nothing stored
```

The update checks what Geofabrik publishes (size, date, MD5), does nothing when the installed data is already that version, otherwise downloads to a temporary file and verifies size and MD5; builds the **new index beside the old one**, checks that it opens,
passes SQLite's integrity check and holds a plausible number of businesses, and only then renames it into place (the previous index is kept as `business-index.previous.sqlite`). Any failure leaves the working index exactly as it was.

Everything lives in `%LOCALAPPDATA%\IanProspectAgent\data\osm\`: `belgium-latest.osm.pbf` (source, ~700 MB), `business-index.sqlite` (~30 MB), `metadata.json` (source, MD5, data date, counts, last check/update) and `geocode-cache.json`. `*.osm.pbf` and `business-index*.sqlite` are git-ignored.

**What is indexed.** A built-in, dependency-free PBF reader (no GDAL/osmium/Docker) streams the extract twice without holding it in memory and keeps only **named businesses**: `shop`, `craft`, selected `office` / `amenity` / `tourism` / `healthcare` / `leisure` values
(see `tools/prospect-agent/src/osm/categories.ts`), with their OSM id (`node/…` or `way/…`), position, public contact tags (website, phone, email, Facebook, Instagram), address city and the category. Buildings use the centre of their nodes.
No contributor metadata (user, changeset, timestamps) is read or stored. Chain branches (`brand` tag) are indexed but excluded from searches. The index also holds named places (city, town, village…) so a search centre such as "Brugge" is found locally.
OSM tags are untrusted input: URLs must be public `http(s)` addresses without credentials (max 500 characters), emails must look like emails, names/phones are length-limited and control characters removed; nothing from a tag is ever executed or used as shell syntax.

**A search** geocodes the centre (built-in Brugge coordinates, then the geocode cache, then the local place list, and only for an unknown place one Nominatim lookup), takes every indexed business within the radius using an R*Tree box plus the exact great-circle distance
(the radius comes from the request, e.g. "Brugge + 30 km", default 30 km, and is never chosen by an AI), filters by industry, ranks and returns up to `clamp(count × 12, 30, 200)` businesses. Typical time for Brugge + 30 km on the full Belgian index: about 0.1 s.

* **Industry mapping is a fixed table** (`INDUSTRY_RULES`): bike → `shop=bicycle`, restaurant → `amenity=restaurant`, car detailing → `shop=car_repair|car|car_parts|tyres`, `craft=car_painter`, `amenity=car_wash`, roofing → `craft=roofer|tinsmith`, and so on. An industry with no entry is matched against the listing's category words and name. **OpenStreetMap coverage is incomplete**: a business is only found if a volunteer mapped it with a name and a category, and some trades share a generic tag.
* **Any industry** is not a dump: kinds of business are visited in a fixed, configurable order of usefulness for web work (trades 100, automotive 95, professional services 90, beauty & wellness 85, hospitality 75, retail 70, health 60, services 50), one from each kind in turn, businesses with a website first (for **No Website** mode: without), then the nearest. Override the weights in `config.json`: `"discoveryPriorities": { "hospitality": 120 }`.
* **No website listed** is kept (key: name + locality) and recorded as the listing fact `No website URL is present in the available business listing.` That says what the listing contains; it is not proof that no website exists.
* The **P10 pipeline is unchanged and not part of the source**: CRM duplicate checks, ignored memory, 60-day cooldown, SSRF-safe website analysis, Codex qualification, scoring, threshold and server-side validation all run as before.
* **Provenance**: each business carries `source = local_osm`, the OSM object id and its OpenStreetMap link; each piece of evidence says whether it is a **Listing** fact (OpenStreetMap), a **Website** observation, and the score reasons are Codex's interpretation of exactly that evidence.

**Freshness and fallback.** Data up to 7 days old is *fresh*; older data still works and the agent, `status`, `doctor` and the CRM say it can be refreshed (a manual command; there is no automatic download on start). If the index is **missing**, a search fails immediately with
`Local business data is not installed yet. Run: npm run prospect-agent -- update-business-data` (failure kind `business_data_missing`) instead of waiting minutes on a public server. The public Overpass service is used **only** when explicitly allowed
(`"overpassFallback": true` in `config.json`, or `PROSPECT_AGENT_OVERPASS_FALLBACK=1`) and only when the local data is missing or older than 60 days, with a 45-second budget; if it does not answer, older local data is still used. A healthy local index never contacts Overpass.

**Not integrated (room left).** A future `kbo_validation` step could confirm a business against the Belgian company register (KBO/BCE) behind the same provider interface. It is not part of this milestone, and natural-person data must not be collected for direct marketing.

**Licence.** Data © OpenStreetMap contributors, available under the Open Database License (ODbL); extract provided by Geofabrik GmbH (https://download.geofabrik.de). Listings in the CRM link back to their OpenStreetMap object, and `doctor`/`update-business-data` print the attribution.

### Result quality rules (P10.2.1 and P10.2.2)

All deterministic; none of it is decided by an AI.

* **Placeholder contacts** (`src/lib/prospecting/contact.ts`). `gebruiker@domein.com`, `name@example.com`, `john@doe.com`, `info@yourdomain.*`, reserved example TLDs and template local parts (`voornaam.achternaam`, `yourname`...) are "no verified email": never a contact, never contactability points, dropped by the website extractor, the OSM import and the server. `info@`, `mail@`, `test@realcompany.be` are kept. Obviously fake phone numbers (all one digit, `123456...`) are treated the same way.
* **Which businesses go forward** (`osm/select.ts`). The pipeline analyses the list in order and stops at enough candidates, so the order is what matters. The search radius is split into three bands (0–5, 5–15, 15–30 km at 30 km) and one business is taken from each in turn; inside a band the kinds of business rotate in the configured order with at most 3 of one category per band (the cap rises evenly only if an area is thin); equal listings are visited spread along the distance, not nearest-first. Website presence is not a ranking key: businesses with and without a listed website alternate (No Website mode lists the ones without first). Distance only enforces the requested area; it never lowers a business's rank.
* **Commercial or not** (`osm/categories.ts`, stored per object in the index, schema 2). `commercial` (explicitly private), `likely_commercial` (a shop, craft, restaurant, professional office...), `unknown` (sports centre, clinic, music school... with no operator tag, ranked last), `non_commercial` (town hall, police, fire station, library, school, government office, `operator:type`/`ownership` public or non-profit, charity shop, official government web address; excluded). A privately operated school, gym or care business stays commercial. Names are never used for this.
* **Evidence origins.** Each evidence line is labelled `listing` (OpenStreetMap), `website` (observed on the business's own pages) or `ai` (Codex's interpretation, kept as its own line). The server keeps these labels.

**Missing-website confidence (`src/lib/prospecting/website-state.ts`).** "No website URL in the OSM listing" is not "this business has no website". Each business gets a website state:

| State | Meaning |
| --- | --- |
| `confirmed_website` | The listing has the URL, or a probed address was corroborated by the business's own details: its name AND its phone number, or its name AND the domain of the listing's own (non-Gmail/ISP) email. |
| `probable_website` | A probed address carries the business name and its locality, nothing stronger. Analysed, with lower confidence; not recorded as the business's website. |
| `no_website_found` | At least 3 address probes were answered and none matched. Still not proof. |
| `unknown` | The checks could not settle it (nothing to probe, or timeouts). |

Probes are a few homepage requests (robots.txt respected, SSRF-safe fetcher, no search engine, no paid API): the listing's own email domain, the name joined/hyphenated (`cloetens.be`, `new-cars.be`, `cloetensbv.be`) and the name on the listing's own Facebook/Instagram page. A resolving domain is never enough; matching is exact (whole words, digit strings, the domain), never fuzzy. False attribution is treated as worse than "unknown".

**Score caps (cannot be overridden by the AI; enforced again by the server).** website need (of 25) / conversion gap (of 15): `confirmed_website` 25 / 15 (the site analysis decides), `probable_website` 15 / 9, `no_website_found` 18 / 8, `unknown` 8 / 0. So an OSM-only missing website can add at most 8 points. The other categories and the 100-point model are unchanged. The evidence says exactly what is known ("OSM does not list a website. Website availability remains unconfirmed." / "...and no matching official website was found during the deterministic checks."), and the candidate card shows **Website: Confirmed / Probable / No official website found / Not listed / unconfirmed**.

**Identity confidence** (`high` / `medium` / `low`). Low when a name clearly names one kind of business and the category is another (a business called "New-Cars" tagged `amenity=bicycle_rental`) and no website confirms it. A low-identity listing is not sent to Codex and is never proposed (it is remembered as "skipped").

**Cooldown rule.** A business enters the 60-day cooldown only when it received a complete assessment (candidate or below threshold) or was a confirmed duplicate; a business whose analysis was cut off by a cancel is not remembered. Recommended refinement (needs the context call to carry the outcome, so a database change): remember `unreachable` and `skipped` outcomes for 7–14 days only, since they are usually temporary.

**Real-run evidence behind these rules** (Brugge, 30 km, Any industry, Quick Find): the first run returned only city-centre businesses and a placeholder email; the second showed that 4 of 5 candidates qualified mainly because OpenStreetMap listed no website (one of them, Clicteur, turned out to have a site that the new probes confirm); the third, with all rules active, returned 3 candidates spread over 1.8 / 14.4 / 21.6 km, two with concrete website evidence and one held to the capped missing-website signal.

### Follow-up items (P10.3, deliberately not implemented yet)

1. **Apply the cooldown before the 60-business preselection cap.** The pool is chosen first and the cooldown filter runs after, so repeated searches in the same area spend part of the pool on businesses researched in the last 60 days (36 of 60 in the third real run). Filter first, then cap.
2. **Handle personal Gmail/Hotmail business contacts.** Sole traders list personal-looking mailbox addresses (for example `firstname.lastname@hotmail.com`). They should be flagged as personal data and treated more cautiously for outreach, and not count as a full "professional email".
3. **Make local-relevance scoring deterministic.** Codex currently scores local relevance 5-6 out of 10 at 14-22 km although the business is inside the requested radius; relevance should be computed from the radius, not left to the AI, so distance inside the requested area is not over-penalised.
4. **Shorter cooldowns for `unreachable` and `skipped` outcomes** (7-14 days instead of 60), since they are usually temporary. This needs the outcome to be carried in the agent context call.

## 5. Failures and usage limits

Only a fixed set of kinds ever reaches the CRM; the words are in `src/lib/prospecting/agent/messages.ts`, never raw Codex output.

| Kind | Shown as | What to do |
| --- | --- | --- |
| `codex_not_installed` | Codex CLI is not installed or not on PATH. | install it (setup step 1) |
| `codex_not_authenticated` | Codex CLI is not signed in with ChatGPT… | run `codex`, sign in |
| `codex_usage_limit` | **Your current Codex/ChatGPT usage limit has been reached. Try again when your allowance resets.** | wait for the allowance to reset |
| `codex_timeout` | Codex took too long and was stopped. | retry; try a smaller search |
| `invalid_output` | Codex returned an answer that could not be used. | batches with bad answers are skipped (noted); retry |
| `network_error` | Codex could not reach its service. | check the connection |
| `source_error` | The public business source (OpenStreetMap) is busy… | retry in a few minutes |
| `business_data_missing` | Local business data is not installed on the agent PC yet. Run: `npm run prospect-agent -- update-business-data` | run that command once |
| `agent_error` | The agent stopped with an error. | see the local log |

**There is no fallback.** If the plan allowance is exhausted the run stops (a *partial* run keeps the candidates already found); nothing switches to the OpenAI API or another paid model.
Usage is limited by your plan: each search costs about one Codex call per 6 plausible businesses (Quick Find ≈ 1–3 calls), the deterministic steps cost nothing, businesses are researched once per 60 days, and only plausible businesses reach Codex.

## 6. Troubleshooting

* **CRM says "Local AI agent is offline"**: the agent is not running or has not heartbeated for 90 s. Start it (`npm run prospect-agent -- start`).
* **"needs attention"**: Codex is not installed / not signed in on the PC: `npm run prospect-agent -- doctor`, then fix and the next heartbeat clears it.
* **Token rejected** (agent exits with code 2): the device was revoked or replaced. Generate a new token in Settings and run `setup` again.
* **A run is stuck "Queued"**: no agent online (or Codex not ready). Cancel it or start the agent; a run whose agent died is re-queued automatically after the lease expires.
* **Logs**: `%LOCALAPPDATA%\IanProspectAgent\logs\agent.log`. **Scratch**: `...\runs\` (emptied automatically).
* Codex versions differ: the agent checks the installed `codex exec --help` instead of assuming flags; if a required flag is missing it says so and waits.

## 7. Feature flag and rollout

`AI_PROSPECTING_PROVIDER=local_codex` only enables the queue UI on the main application; **inference never happens on Vercel**, and no OpenAI credential is added to any project. It must **not** be set on `preview-gateway`
(which would not serve these routes anyway: every `/api` path and the whole CRM answer 404 there). `disabled` and `mock` are unchanged (the mock stays local-only).
Rollout order: (A) build and test with the flag off; (B) run the agent against a local CRM/Supabase; (C) deploy the API and migration with the flag still off; (D) register the PC; (E) `test-codex`; (F) set the flag on `ian-portfolio` only;
(G) one Quick Find (Brugge, 5 results, minimum 70), review by hand, add nothing automatically.

## 8. Not built (by design)

Automatic outreach, email sending, contact-form submission, autonomous prospect additions, API-key inference, a cloud worker, a Windows service / autostart, realtime push to the agent, multi-device dispatch, a CRM button for the Codex test (it is a CLI command), un-ignoring candidates.

## 9. Tests

`npm test` covers the worker (fake Codex through a real Windows `.cmd` shim in a folder with a space, failure kinds, cancellation, lease loss, usage exhaustion, malformed/oversized output, timeouts, no-secret grep), the API (validation, rejection of bad candidates,
rate limit) and the UI states. `npm run test:rls` (local Supabase) covers the real functions: wrong and revoked tokens, two workers claiming the same run, expired leases and retries, ownership, server-side rejection, no side effects on existing data.
`tools/prospect-agent/dev/fake-codex.cmd` is a stand-in `codex` for local end-to-end runs without a ChatGPT sign-in (`CODEX_BIN` points at it; `PROSPECT_AGENT_SOURCE=sample` swaps discovery for invented businesses and only works against a local CRM).
