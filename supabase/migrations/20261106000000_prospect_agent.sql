-- Local Prospect Agent (P10.1): a job queue for the Prospect Finder, worked by a small program on Ian's own PC that runs Codex CLI.
-- Additive on top of P10 (20261105000000). Nothing here is reachable by the public site; nothing runs until an admin creates a device.
--
-- Security model. The agent never gets a database key. It holds one random connection token (256 bits, shown once, stored here only as a
-- SHA-256 hash). The CRM's API routes call the narrow SECURITY DEFINER functions below with that token; every function re-checks the token
-- (revoked tokens stop working immediately), that the run belongs to the calling agent and that its lease is still valid. The functions
-- can do exactly five things: heartbeat, claim a queued run, report progress, submit results, fail a run. There is no general read or write.

create table public.prospect_agents (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  -- SHA-256 (hex) of the connection token. The token itself is never stored.
  token_hash text not null unique check (char_length(token_hash) = 64),
  -- The first characters of the token, so a device can be told apart in the list. Not secret enough to matter on its own.
  token_hint text not null check (char_length(token_hint) <= 12),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  -- Diagnostics reported by the agent (never credentials): `codex --version` and whether Codex is usable.
  codex_version text check (char_length(codex_version) <= 60),
  codex_state text check (codex_state in ('ready', 'not_installed', 'not_authenticated', 'error')),
  last_failure_kind text check (char_length(last_failure_kind) <= 40)
);
-- One personal CRM, one device: at most one agent can be active at a time. Rotating a token revokes the old device first.
create unique index prospect_agents_one_active on public.prospect_agents ((true)) where revoked_at is null;

alter table public.prospect_agents enable row level security;
revoke all on public.prospect_agents from anon, authenticated;
-- Admins can list devices and create/revoke them, but never read the token hash back.
grant select (id, display_name, token_hint, created_at, created_by, last_seen_at, revoked_at, codex_version, codex_state, last_failure_kind) on public.prospect_agents to authenticated;
grant insert (display_name, token_hash, token_hint, created_by) on public.prospect_agents to authenticated;
grant update (revoked_at) on public.prospect_agents to authenticated;
create policy "prospect_agents: admins only" on public.prospect_agents
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The run queue: extra states, a lease and an audit trail on the P10 runs.
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.prospect_discovery_runs drop constraint prospect_discovery_runs_status_check;
alter table public.prospect_discovery_runs add constraint prospect_discovery_runs_status_check check (status in
  ('queued', 'claimed', 'discovering', 'analyzing', 'qualifying', 'running', 'completed', 'partial', 'failed', 'cancelled'));

alter table public.prospect_discovery_runs
  add column agent_id uuid references public.prospect_agents (id) on delete set null,
  add column lease_expires_at timestamptz,
  add column heartbeat_at timestamptz,
  add column attempts smallint not null default 0 check (attempts >= 0),
  add column cancel_requested boolean not null default false,
  -- Sanitised failure kind: codex_not_installed, codex_not_authenticated, codex_usage_limit, codex_timeout, invalid_output, network_error, ...
  add column failure_kind text check (char_length(failure_kind) <= 40),
  add column codex_ms integer check (codex_ms >= 0),
  add column codex_calls smallint check (codex_calls >= 0),
  -- A few lines of history: queued, claimed by <device>, completed, failed, cancelled. Not a log.
  add column events jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array' and jsonb_array_length(events) <= 30);

create index prospect_discovery_runs_queue_idx on public.prospect_discovery_runs (status, started_at) where status in ('queued', 'claimed', 'discovering', 'analyzing', 'qualifying');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Functions the agent API calls. All SECURITY DEFINER with an empty search_path.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.agent_resolve(p_token text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.prospect_agents a
   where a.revoked_at is null
     and p_token is not null
     and char_length(p_token) between 32 and 200
     and a.token_hash = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
$$;
revoke all on function public.agent_resolve(text) from public, anon, authenticated;

-- One heartbeat: proves the device is alive and carries its diagnostics.
create function public.agent_heartbeat(p_token text, p_codex_version text, p_codex_state text, p_failure text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_name text;
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  update public.prospect_agents
     set last_seen_at = now(),
         codex_version = left(p_codex_version, 60),
         codex_state = case when p_codex_state in ('ready', 'not_installed', 'not_authenticated', 'error') then p_codex_state else null end,
         last_failure_kind = left(p_failure, 40)
   where id = v_agent
  returning display_name into v_name;
  return jsonb_build_object('ok', true, 'device', v_name);
end;
$$;

-- Claim the oldest queued run, if any. A run whose lease ran out (the agent died) goes back to the queue, and is failed after three attempts.
create function public.agent_claim_run(p_token text, p_lease_seconds integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_name text;
  v_run public.prospect_discovery_runs;
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 90), 30), 300);
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  update public.prospect_agents set last_seen_at = now() where id = v_agent returning display_name into v_name;

  update public.prospect_discovery_runs
     set status = 'cancelled', finished_at = now(), stage = 'Cancelled',
         events = events || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'cancelled'))
   where status in ('claimed', 'discovering', 'analyzing', 'qualifying') and lease_expires_at < now() and cancel_requested;
  update public.prospect_discovery_runs
     set status = 'failed', failure_kind = 'agent_stopped', finished_at = now(), stage = 'The agent stopped responding',
         events = events || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'failed', 'kind', 'agent_stopped'))
   where status in ('claimed', 'discovering', 'analyzing', 'qualifying') and lease_expires_at < now() and attempts >= 3;
  update public.prospect_discovery_runs
     set status = 'queued', agent_id = null, lease_expires_at = null, stage = 'Waiting for the agent…',
         events = events || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'requeued'))
   where status in ('claimed', 'discovering', 'analyzing', 'qualifying') and lease_expires_at < now();

  with next as (
    select id from public.prospect_discovery_runs
     where status = 'queued' and not cancel_requested
     order by started_at
     limit 1
     for update skip locked
  )
  update public.prospect_discovery_runs r
     set status = 'claimed', agent_id = v_agent, lease_expires_at = now() + make_interval(secs => v_lease), heartbeat_at = now(),
         attempts = r.attempts + 1, stage = 'Picked up by ' || v_name,
         events = r.events || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'claimed', 'by', v_name))
    from next
   where r.id = next.id
  returning r.* into v_run;

  if v_run.id is null then return jsonb_build_object('ok', true, 'run', null); end if;
  return jsonb_build_object('ok', true, 'run', jsonb_build_object(
    'id', v_run.id, 'mode', v_run.mode, 'location', v_run.location, 'area', v_run.area, 'industry', v_run.industry,
    'threshold', v_run.threshold, 'count', v_run.requested_count, 'excludeResearched', v_run.exclude_researched, 'attempt', v_run.attempts));
end;
$$;

-- Progress for a run the caller owns. Extends the lease; tells the agent whether the admin asked to cancel.
create function public.agent_progress(p_token text, p_run uuid, p_status text, p_stage text, p_counters jsonb, p_errors jsonb, p_lease_seconds integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_run public.prospect_discovery_runs;
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 90), 30), 300);
  v_errors jsonb;
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  select * into v_run from public.prospect_discovery_runs where id = p_run for update;
  if v_run.id is null or v_run.agent_id is distinct from v_agent
     or v_run.status not in ('claimed', 'discovering', 'analyzing', 'qualifying') or v_run.lease_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'lease_lost');
  end if;
  select coalesce(jsonb_agg(left(e, 200)), '[]'::jsonb) into v_errors
    from (select jsonb_array_elements_text(case when jsonb_typeof(p_errors) = 'array' then p_errors else '[]'::jsonb end) as e limit 25) t;
  update public.prospect_discovery_runs
     set status = case when p_status in ('discovering', 'analyzing', 'qualifying') then p_status else status end,
         stage = left(coalesce(p_stage, stage), 80),
         raw_found = least(greatest(coalesce((p_counters ->> 'raw_found')::integer, raw_found), 0), 100000),
         analyzed = least(greatest(coalesce((p_counters ->> 'analyzed')::integer, analyzed), 0), 100000),
         qualified = least(greatest(coalesce((p_counters ->> 'qualified')::integer, qualified), 0), 100000),
         duplicates_removed = least(greatest(coalesce((p_counters ->> 'duplicates_removed')::integer, duplicates_removed), 0), 100000),
         skipped_cooldown = least(greatest(coalesce((p_counters ->> 'skipped_cooldown')::integer, skipped_cooldown), 0), 100000),
         errors = v_errors,
         lease_expires_at = now() + make_interval(secs => v_lease),
         heartbeat_at = now()
   where id = p_run;
  update public.prospect_agents set last_seen_at = now() where id = v_agent;
  return jsonb_build_object('ok', true, 'cancel', v_run.cancel_requested);
end;
$$;

-- What the agent needs to skip businesses the CRM already knows. Only business facts and HASHED emails: never a raw email, a note or any mail.
create function public.agent_context(p_token text, p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_run public.prospect_discovery_runs;
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  select * into v_run from public.prospect_discovery_runs where id = p_run;
  if v_run.id is null or v_run.agent_id is distinct from v_agent or v_run.lease_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'lease_lost');
  end if;
  return jsonb_build_object('ok', true,
    'run', jsonb_build_object('threshold', v_run.threshold, 'mode', v_run.mode, 'count', v_run.requested_count),
    'prospects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'company_name', p.company_name, 'website_url', p.website_url, 'city', p.city,
        'email_hash', case when p.email is null then null else encode(extensions.digest(convert_to(lower(btrim(p.email)), 'utf8'), 'sha256'), 'hex') end))
        from (select * from public.prospects limit 20000) p), '[]'::jsonb),
    'decided', coalesce((select jsonb_agg(jsonb_build_object('status', c.status, 'company_name', c.company_name, 'website_url', c.website_url, 'city', c.city,
        'email_hash', case when c.email is null then null else encode(extensions.digest(convert_to(lower(btrim(c.email)), 'utf8'), 'sha256'), 'hex') end))
        from (select * from public.prospect_discovery_candidates where status in ('ignored', 'pending') limit 5000) c), '[]'::jsonb),
    'seen', coalesce((select jsonb_agg(jsonb_build_object('domain', s.domain, 'last_analyzed_at', s.last_analyzed_at))
        from (select * from public.prospect_discovery_seen limit 20000) s), '[]'::jsonb));
end;
$$;

-- Final result of a run: candidates, duplicates, the cooldown memory and the terminal status. Already-known businesses are skipped here as well,
-- whatever the agent says (CRM prospect with the same email or website host; candidate with the same domain or email).
create function public.agent_submit(p_token text, p_run uuid, p_candidates jsonb, p_duplicates jsonb, p_seen jsonb, p_final jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_run public.prospect_discovery_runs;
  v_name text;
  c jsonb;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_status text;
  v_domain text;
  v_email text;
  v_errors jsonb;
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  select * into v_run from public.prospect_discovery_runs where id = p_run for update;
  if v_run.id is null or v_run.agent_id is distinct from v_agent
     or v_run.status not in ('claimed', 'discovering', 'analyzing', 'qualifying') or v_run.lease_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'lease_lost');
  end if;
  select display_name into v_name from public.prospect_agents where id = v_agent;

  for c in select * from jsonb_array_elements(case when jsonb_typeof(p_candidates) = 'array' then p_candidates else '[]'::jsonb end) limit 50 loop
    v_domain := nullif(lower(c ->> 'domain'), '');
    v_email := nullif(lower(btrim(c ->> 'email')), '');
    if (v_email is not null and (exists (select 1 from public.prospects p where lower(btrim(p.email)) = v_email)
                              or exists (select 1 from public.prospect_discovery_candidates x where lower(btrim(x.email)) = v_email and x.status in ('pending', 'added', 'ignored'))))
       or (v_domain is not null and (exists (select 1 from public.prospects p where p.website_url is not null
                                       and regexp_replace(lower(p.website_url), '^https?://(www\.)?([^/:?#]+).*$', '\2') = v_domain)
                                  or exists (select 1 from public.prospect_discovery_candidates x where x.domain = v_domain and x.status in ('pending', 'added', 'ignored')))) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.prospect_discovery_candidates
      (run_id, company_name, website_url, domain, email, phone, city, region, industry, score, score_breakdown, summary, opportunity, evidence, source_urls, synthetic, status)
    values
      (p_run, left(c ->> 'company_name', 200), nullif(c ->> 'website_url', ''), v_domain, v_email, nullif(left(c ->> 'phone', 60), ''), nullif(left(c ->> 'city', 120), ''),
       nullif(left(c ->> 'region', 120), ''), nullif(left(c ->> 'industry', 120), ''), (c ->> 'score')::smallint, coalesce(c -> 'score_breakdown', '{}'::jsonb),
       left(c ->> 'summary', 1000), left(c ->> 'opportunity', 300), coalesce(c -> 'evidence', '[]'::jsonb), coalesce(c -> 'source_urls', '[]'::jsonb), false, 'pending');
    v_inserted := v_inserted + 1;
  end loop;

  for c in select * from jsonb_array_elements(case when jsonb_typeof(p_duplicates) = 'array' then p_duplicates else '[]'::jsonb end) limit 20 loop
    insert into public.prospect_discovery_candidates (run_id, company_name, website_url, domain, email, city, score, status, duplicate_of, duplicate_reason, synthetic)
    values (p_run, left(c ->> 'company_name', 200), nullif(c ->> 'website_url', ''), nullif(lower(c ->> 'domain'), ''), nullif(lower(btrim(c ->> 'email')), ''),
            nullif(left(c ->> 'city', 120), ''), 0, 'rejected_duplicate', (select id from public.prospects where id = nullif(c ->> 'duplicate_of', '')::uuid), left(c ->> 'duplicate_reason', 200), false);
  end loop;

  insert into public.prospect_discovery_seen (domain, outcome, last_score, last_analyzed_at, run_id)
  select lower(left(s ->> 'domain', 253)), s ->> 'outcome', nullif(s ->> 'score', '')::smallint, now(), p_run
    from jsonb_array_elements(case when jsonb_typeof(p_seen) = 'array' then p_seen else '[]'::jsonb end) s
   where s ->> 'outcome' in ('candidate', 'below_threshold', 'duplicate', 'unreachable', 'skipped') and coalesce(s ->> 'domain', '') <> ''
   limit 100
  on conflict (domain) do update set outcome = excluded.outcome, last_score = excluded.last_score, last_analyzed_at = excluded.last_analyzed_at, run_id = excluded.run_id;

  v_status := case when p_final ->> 'status' in ('completed', 'partial', 'cancelled') then p_final ->> 'status' else 'completed' end;
  select coalesce(jsonb_agg(left(e, 200)), '[]'::jsonb) into v_errors
    from (select jsonb_array_elements_text(case when jsonb_typeof(p_final -> 'errors') = 'array' then p_final -> 'errors' else '[]'::jsonb end) as e limit 25) t;
  update public.prospect_discovery_runs
     set status = v_status, stage = left(p_final ->> 'stage', 80), finished_at = now(), lease_expires_at = null,
         raw_found = least(greatest(coalesce((p_final #>> '{counters,raw_found}')::integer, 0), 0), 100000),
         analyzed = least(greatest(coalesce((p_final #>> '{counters,analyzed}')::integer, 0), 0), 100000),
         qualified = v_inserted,
         duplicates_removed = least(greatest(coalesce((p_final #>> '{counters,duplicates_removed}')::integer, 0), 0), 100000),
         skipped_cooldown = least(greatest(coalesce((p_final #>> '{counters,skipped_cooldown}')::integer, 0), 0), 100000),
         errors = v_errors,
         failure_kind = case when p_final ->> 'failure_kind' in ('codex_not_installed', 'codex_not_authenticated', 'codex_usage_limit', 'codex_timeout', 'invalid_output', 'network_error', 'source_error', 'agent_error') then p_final ->> 'failure_kind' else null end,
         codex_ms = least(greatest(coalesce((p_final ->> 'codex_ms')::integer, 0), 0), 86400000),
         codex_calls = least(greatest(coalesce((p_final ->> 'codex_calls')::integer, 0), 0), 1000),
         events = events || jsonb_build_array(jsonb_build_object('at', now(), 'type', v_status, 'by', v_name))
   where id = p_run;
  update public.prospect_agents set last_seen_at = now(), last_failure_kind = null where id = v_agent;
  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'skipped_known', v_skipped);
end;
$$;

-- A run that could not finish. The kind is one of a fixed set, the message is short and sanitised by the agent. Releases the lease.
create function public.agent_fail(p_token text, p_run uuid, p_kind text, p_message text, p_status text default 'failed')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_run public.prospect_discovery_runs;
  v_name text;
  v_kind text := case when p_kind in ('codex_not_installed', 'codex_not_authenticated', 'codex_usage_limit', 'codex_timeout', 'invalid_output', 'network_error', 'source_error', 'agent_error', 'cancelled')
                      then p_kind else 'agent_error' end;
  v_status text := case when p_status in ('failed', 'partial', 'cancelled') then p_status else 'failed' end;
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  select * into v_run from public.prospect_discovery_runs where id = p_run for update;
  if v_run.id is null or v_run.agent_id is distinct from v_agent or v_run.status not in ('claimed', 'discovering', 'analyzing', 'qualifying') then
    return jsonb_build_object('ok', false, 'error', 'lease_lost');
  end if;
  select display_name into v_name from public.prospect_agents where id = v_agent;
  update public.prospect_discovery_runs
     set status = v_status, failure_kind = v_kind, finished_at = now(), lease_expires_at = null, stage = left(coalesce(p_message, 'Run stopped'), 80),
         errors = (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select jsonb_array_elements_text(errors) e union select left(coalesce(p_message, v_kind), 200)) t),
         events = events || jsonb_build_array(jsonb_build_object('at', now(), 'type', v_status, 'by', v_name, 'kind', v_kind))
   where id = p_run;
  update public.prospect_agents set last_seen_at = now(), last_failure_kind = v_kind where id = v_agent;
  return jsonb_build_object('ok', true);
end;
$$;

-- The few parameters of a run the server needs to re-validate a submitted result (no business data).
create function public.agent_run_params(p_token text, p_run uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_run public.prospect_discovery_runs;
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  select * into v_run from public.prospect_discovery_runs where id = p_run;
  if v_run.id is null or v_run.agent_id is distinct from v_agent or v_run.lease_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'lease_lost');
  end if;
  return jsonb_build_object('ok', true, 'threshold', v_run.threshold, 'mode', v_run.mode, 'count', v_run.requested_count);
end;
$$;

-- Only the agent functions are callable by the API's (anonymous) role; the helper is internal.
revoke all on function public.agent_heartbeat(text, text, text, text), public.agent_claim_run(text, integer),
  public.agent_progress(text, uuid, text, text, jsonb, jsonb, integer), public.agent_context(text, uuid),
  public.agent_submit(text, uuid, jsonb, jsonb, jsonb, jsonb), public.agent_fail(text, uuid, text, text, text), public.agent_run_params(text, uuid) from public, anon, authenticated;
grant execute on function public.agent_heartbeat(text, text, text, text), public.agent_claim_run(text, integer),
  public.agent_progress(text, uuid, text, text, jsonb, jsonb, integer), public.agent_context(text, uuid),
  public.agent_submit(text, uuid, jsonb, jsonb, jsonb, jsonb), public.agent_fail(text, uuid, text, text, text), public.agent_run_params(text, uuid) to anon;
