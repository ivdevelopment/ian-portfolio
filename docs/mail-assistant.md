# Mail Assistant (P10.5)

The **Mail Assistant** tab in every prospect dossier recommends the *next* appropriate outreach action and, when a message is called for, writes a
draft Ian can edit, copy into Zoho and send himself. It replaces asking ChatGPT by hand "what do I send next?" and it uses the CRM history.

**It never sends anything.** No send, no reply, no scheduled or bulk mail, no automatic follow-up. Ian is the final decision-maker.

```
Prospect dossier → Mail Assistant
  deterministic facts + plan (rules, no AI)  ──►  "Wait until 10 Nov" / "No action" / "Follow up today"   (instant, no Codex)
        │ only when a message is called for AND Ian presses Generate / Regenerate / Refresh
        ▼
  queued request (prospect_mail_recommendations)  ──►  Ian Prospect Agent (his PC)  ──►  Codex (ChatGPT plan)
        ▲                                                                                  │
        └──────────  validated draft (server re-checks it against the stored plan)  ◄──────┘
```

## 1. Deterministic first, Codex second

`src/lib/mail-assistant/` builds the state from the CRM, with no AI:

| Source | Used for |
| --- | --- |
| Synced Zoho mail (metadata + short snippet, direction, time) | last outgoing / incoming, unanswered messages, language, the prospect's latest message |
| CRM activities (`contacted`, `follow_up_sent`, `reply_received`, `concept_sent`, `quote_sent`, `meeting_planned`) | the same, for mail that was logged by hand |
| Quotes (status, sent date, title) | quote follow-up, accepted / declined |
| Client preview (linked, **first** viewed) | concept follow-up timing (never revealed in a mail) |
| Discovery insight | only the website observations and the suggested service; no score, no listing facts, no AI interpretation |
| Prospect (status, contact, sector, city, website, contact dates) | context; imported contact dates count as earlier outreach |

Several messages on the same Brussels day count as **one touch**, so a mail that is both synced and logged by hand is not counted twice.
Facts include `last_outgoing_days_ago`, `unanswered_touches`, `has_reply`, `latest_is_incoming`, the concept / quote state and the conversation language.

## 2. Actions, sequence and timing

Fixed vocabulary (the model cannot invent workflow names): `first_outreach`, `follow_up`, `reply`, `concept_follow_up`, `quote_follow_up`,
`meeting_follow_up`, `wait`, `no_action`.

Order of decisions: closed status → no action · they wrote last → reply · accepted/declined quote → no action · open quote → quote follow-up ·
concept shared → concept follow-up · meeting planned → meeting follow-up · otherwise the outreach sequence.

**Sequence** (deliberately short): first message → follow-up 1 → follow-up 2 (final, says so) → **stop**. Three unanswered messages
means "leave this prospect alone". Quote and concept sequences stop after two unanswered follow-ups. Won, Lost, Not interested and No response never get cold outreach.

**Timing** (business days, `TIMING` in `plan.ts`, meant to be configurable later): follow-up 1 after 3-5, follow-up 2 after 5-7, concept after 2-4 from the first
preview view (3-5 when only sent), quote 3-5 then 5-7, meeting 2. Business days are Monday-Friday except Belgian public holidays (fixed and Easter-based),
in Europe/Brussels. A draft is suggested for **today during working hours (before 17:00)**, otherwise the next business day. Nothing is scheduled.

A "wait" shows the date: *You emailed this prospect yesterday. Recommended follow-up: 10 Nov 2026*, with no blank draft and no Codex call.

## 3. What Codex sees and writes

The CRM server builds the plan and a **minimal context** (company, contact first name, sector, city, website host, CRM status, a few clean website observations,
up to 8 history items as "days ago" with subject and snippet, the prospect's latest message for a reply, quote state, whether a concept was shared). It never contains
email addresses, scores, notes, amounts, other prospects or tracking details. The agent reuses the existing Codex runner (read-only sandbox, prompt on stdin, strict
JSON schema, no search), writes the draft, and checks it with the same guardrails as the server; a rejected draft is retried **once** with the exact reason.

Style rules in the prompt: natural Belgian Dutch by default (English when the conversation is English, never switching mid-thread), short, personal, no exclamation marks, no emoji,
one or two concrete observations phrased kindly, follow-ups much shorter than a first message, final follow-up says it is the last, never mention scores, AI, OSM, scraping,
analysis, tracking or views, never insult the site.

## 4. Guardrails (`validate.ts`, run on the PC and again on the server against the **stored** plan)

* No draft unless the plan itself calls for one (wait, no action and "more context needed" never get a draft). Inconsistent answers (a follow-up "now" for someone emailed yesterday) are rejected; the request fails with a fixed kind.
* The action must be the plan's action; the **date and "send now" come from the plan**, whatever the model said.
* Subject 3-120 chars, one line; body length by type (first 1100, reply 1500, others 750); language must match the conversation.
* Rejected: AI/score/OSM/CRM/automation/tracking words, sentence-level "I saw that you viewed it" (a normal "did you have a look?" is fine), insults ("outdated", "slecht", ...), links, placeholders, exclamation marks, emoji.

## 5. Freshness

Each draft stores a **fingerprint** of the history it was based on (mail, relevant activities, quotes, first preview view, status). If it changes (for example after a Zoho sync) the page shows
*New mail activity detected* (or *This prospect's history changed*), keeps the old draft collapsed without copy buttons, and offers **Refresh recommendation**. The same happens when time has moved on and the rules
now call for another step. Opening the page never calls Codex; only Generate, Regenerate and Refresh do.

## 6. Data and security

* Table `prospect_mail_recommendations` (migration `20261108000000_mail_assistant.sql`) is both queue and store: `queued → generating → current → used | superseded | dismissed`, or `failed`. One open request and one current draft per prospect (unique indexes), a lease on the agent's claim (re-queued if the agent stops, failed after three tries).
* RLS: admins only. Column grants let an admin session queue a request, dismiss or mark used, but **never write a subject or body**: only the agent functions produce a draft, and the API validates it first.
* The agent uses the **same device token** and four new narrow functions (`agent_mail_claim / progress / params / submit / fail`); no database key, no new Zoho scope, no API key, no OpenAI billing. If the agent is offline the tab says *Mail Assistant unavailable. Start Ian Prospect Agent on your PC.* and there is no fallback.
* "Mark as used" stores `used_at` and adds an activity `mail_assistant_used` (not counted as outgoing mail, never changes the status). Zoho sync remains the source of truth for what was actually sent. "Mark prospect as Contacted?" is an explicit optional button.
* Zoho stores only metadata and short snippets; nothing is fetched automatically. A reply whose snippet is too short (< 20 characters) shows *More email context needed* instead of a guess.

## 7. UI

Tab **Mail Assistant** after Email: suggested action, recommended timing, why, loading states (*Checking history…*, *Waiting for Ian Prospect Agent…*, *Generating draft…*, *Draft ready*; no fake percentages),
editable subject and body (edits are never overwritten by refreshes), **Copy subject / Copy body / Copy both**, **Regenerate**, **Mark as used**, **Dismiss**, **Cancel request**.

### 7a. Tone and Regenerate mail (P10.5.1)

Style only. The action, language, timing and every guardrail stay deterministic; tone never changes them.

- **Default tone is Casual / Human** (also for plain *Generate draft*): natural Belgian Dutch, short, personal, like a freelance developer writing by hand; one concrete observation, one practical idea, one low-pressure question.
  The prompt names the stock sales phrases to avoid (*als dat voor jullie interessant is*, *digitale aanwezigheid*, *op maat gemaakte oplossing*, *efficiënte workflow*, *streamlinen*, …) and fake familiarity; the validator rejects them as multi-word phrases (normal Dutch words stay allowed).
- **Ian writing voice (P10.5.2)** (`voice.ts`) is the default style context of every generation: natural Belgian Dutch, relaxed professional, short, not agency/corporate/sales copy, no fixed observation-solution-pitch-CTA structure, varied openings and closings (a deterministic per-prospect nudge picks a suggested opening; the model may deviate), plus a few varied invented few-shot examples of other businesses (voice only, never copied) and a list of templated constructions to avoid. The validator rejects the multi-word templates (*zou je het fijn vinden*, *zou zoiets voor jullie van pas komen*, *zou dit interessant zijn*, *ik had een klein idee* as a paragraph opener, *website optimaliseren*, the stock sales phrases above); single words stay allowed. The presets are variations of this voice: Casual = Ian as is, Friendly = warmer, Professional = cleaner, Direct = shorter, Soft sales = slightly more persuasive, Very short = compressed, Custom = Casual + the instruction. Wording only; every deterministic rule is unchanged. **Professional (P10.5.3)** additionally carries Ian's approved reference mail (`PROFESSIONAL_REFERENCE_NL`, generic business name, calibration only, never copied) as its main few-shot, with `Beste,` / `Met vriendelijke groeten,` and the natural self-introduction *Ik werk als freelance webdeveloper*; it replaces the casual examples for a first mail, and the other presets are unchanged. No migration; **rebuild and reinstall the tray app** (the prompt and validator are bundled).
- **Regenerate mail** (next to Mark as used / Dismiss, only when a current draft exists and the recommendation is not `wait`/outdated) opens presets **Casual, Friendly, Professional, Direct, Soft sales, Very short, Custom** and an optional custom instruction (≤ 200 chars). *Custom* = casual + the instruction.
- `tone_preset` and `custom_instruction` are stored on the recommendation and travel in the stored plan and the Codex job input (`context.tone`). Codex never returns a tone. The new draft supersedes the previous one (history kept); nothing is marked used and the prospect status is unchanged.
- The custom instruction is an **untrusted style preference**: sanitised, fenced in the prompt, and unable to change action, language, facts, timing or rules. Follow-ups stay shorter than first outreach; *Very short* uses stricter length limits (first 450, reply 700, other 300 chars); an unknown preset is rejected.
- Migration `20261109000000_mail_tone.sql` only adds the two columns and the insert grant. The worker bundles the prompt and validator, so **rebuild and reinstall the tray app** after deploying.

## 8. Tests and local QA

`tests/mail-assistant-core.test.ts` (timing, facts, plan, language, fingerprint, guardrails), `mail-assistant-agent.test.ts` (API, agent job with a scripted Codex, worker, tray), `mail-assistant-ui.test.tsx` (view model and component),
`rls-mail-assistant.integration.test.ts` (real local Supabase: RLS, forged drafts, leases, supersession, stale detection, offline). `tools/prospect-agent/dev/fake-codex.cjs` answers mail prompts with canned compliant drafts for local end-to-end runs.

## 9. Rollout notes

Apply the migration, deploy the app, then **rebuild and reinstall Ian Prospect Agent**: the worker is bundled into the tray app, so until it is updated a request simply stays *Waiting for Ian Prospect Agent…* (an older agent ignores the new operations and an older CRM ignores a newer agent).

## 10. Not built (by design)

Sending, replying, scheduling, bulk mail, automatic follow-ups, fetching full Zoho bodies, a configuration screen for the timing numbers, storing "wait" recommendations.
