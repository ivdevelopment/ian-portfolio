-- AI Prospect Finder (P10): discovery runs, reviewable candidates and a per-domain cooldown memory.
-- Additive and inert: nothing existing is altered, nothing is written until an admin starts a run, and nothing here ever
-- becomes a prospect without an explicit "Add prospect" by an admin.
--
-- Data handling: only small extracted observations (URL, title, a short fact, timestamp), a score and a reasoning summary are
-- kept. Third-party pages are never archived. Business-relevant, public information only. Admin-only RLS; `anon` has no grants.

create table public.prospect_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('quick', 'deep', 'no_website', 'redesign', 'web_app', 'industry')),
  location text not null check (char_length(location) between 1 and 160),
  area text check (char_length(area) <= 160),
  industry text check (char_length(industry) <= 160),
  -- Minimum score (0-100) a business needs to be shown as a candidate in this run.
  threshold smallint not null default 70 check (threshold between 0 and 100),
  requested_count smallint not null check (requested_count between 1 and 50),
  exclude_researched boolean not null default true,
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  -- What the run is doing right now (shown as progress); a free label chosen by the pipeline.
  stage text check (char_length(stage) <= 80),
  provider text not null check (char_length(provider) <= 40),
  raw_found integer not null default 0 check (raw_found >= 0),
  analyzed integer not null default 0 check (analyzed >= 0),
  qualified integer not null default 0 check (qualified >= 0),
  duplicates_removed integer not null default 0 check (duplicates_removed >= 0),
  skipped_cooldown integer not null default 0 check (skipped_cooldown >= 0),
  -- Short, non-secret messages ("website unreachable: example.be"). Never tokens or model output.
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references auth.users (id) on delete set null
);
create index prospect_discovery_runs_started_idx on public.prospect_discovery_runs (started_at desc);

create table public.prospect_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.prospect_discovery_runs (id) on delete cascade,

  company_name text not null check (char_length(btrim(company_name)) between 1 and 200),
  contact_name text check (char_length(contact_name) <= 160),
  website_url text check (char_length(website_url) <= 500),
  -- Normalised host of the website (no www), the key for duplicate detection and the cooldown.
  domain text check (char_length(domain) <= 253),
  email text check (char_length(email) <= 320),
  phone text check (char_length(phone) <= 60),
  city text check (char_length(city) <= 120),
  region text check (char_length(region) <= 120),
  industry text check (char_length(industry) <= 120),

  score smallint not null check (score between 0 and 100),
  -- { business_fit, website_need, conversion_gap, service_opportunity, local_relevance, contactability: { score, max, reason } }
  score_breakdown jsonb not null default '{}'::jsonb check (jsonb_typeof(score_breakdown) = 'object'),
  summary text check (char_length(summary) <= 1000),
  opportunity text check (char_length(opportunity) <= 300),
  -- [{ id, url, title, fact, at }] small extracted observations; reasons in score_breakdown refer to these ids.
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  source_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(source_urls) = 'array'),
  -- True for the development mock provider: never real businesses.
  synthetic boolean not null default false,

  status text not null default 'pending' check (status in ('pending', 'added', 'ignored', 'rejected_duplicate')),
  -- For rejected_duplicate: the CRM prospect it matched and which deterministic rule matched.
  duplicate_of uuid references public.prospects (id) on delete set null,
  duplicate_reason text check (char_length(duplicate_reason) <= 200),

  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  added_prospect_id uuid references public.prospects (id) on delete set null,
  ignored_at timestamptz,
  decision_note text check (char_length(decision_note) <= 300),

  check (status <> 'ignored' or ignored_at is not null),
  check (status <> 'added' or reviewed_at is not null)
);
create index prospect_discovery_candidates_run_idx on public.prospect_discovery_candidates (run_id);
create index prospect_discovery_candidates_status_idx on public.prospect_discovery_candidates (status, score desc);
create index prospect_discovery_candidates_domain_idx on public.prospect_discovery_candidates (domain) where domain is not null;
create index prospect_discovery_candidates_added_idx on public.prospect_discovery_candidates (added_prospect_id) where added_prospect_id is not null;

-- Cooldown memory: one row per analysed domain, so a business that scored too low (and is therefore not a candidate) is not
-- analysed again in every run. The cooldown length is a code constant (src/lib/prospecting/dedupe.ts).
create table public.prospect_discovery_seen (
  domain text primary key check (char_length(domain) <= 253 and domain = lower(domain)),
  last_analyzed_at timestamptz not null default now(),
  last_score smallint check (last_score between 0 and 100),
  outcome text not null check (outcome in ('candidate', 'below_threshold', 'duplicate', 'unreachable', 'skipped')),
  run_id uuid references public.prospect_discovery_runs (id) on delete set null
);

alter table public.prospect_discovery_runs enable row level security;
alter table public.prospect_discovery_candidates enable row level security;
alter table public.prospect_discovery_seen enable row level security;

revoke all on public.prospect_discovery_runs, public.prospect_discovery_candidates, public.prospect_discovery_seen from anon, authenticated;
grant select, insert, update on public.prospect_discovery_runs to authenticated;
grant select, insert, update on public.prospect_discovery_candidates to authenticated;
grant select, insert, update on public.prospect_discovery_seen to authenticated;

create policy "prospect_discovery_runs: admins only" on public.prospect_discovery_runs
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "prospect_discovery_candidates: admins only" on public.prospect_discovery_candidates
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "prospect_discovery_seen: admins only" on public.prospect_discovery_seen
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
