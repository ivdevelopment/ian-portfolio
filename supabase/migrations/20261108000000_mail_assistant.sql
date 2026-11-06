-- Mail Assistant (P10.5): one AI-assisted draft per prospect, written by Codex on Ian's own PC through the existing Local Prospect Agent.
-- Additive. Nothing here sends mail; the table only stores the last recommendation and the queue of requests for new ones.
--
-- The table is both queue and store:  queued -> generating -> current -> used | superseded | dismissed   (or failed).
--   queued       the CRM asked for a draft (explicit Generate / Regenerate only; never on page load)
--   generating   the agent claimed it (a lease, extended while Codex works; an expired lease puts it back, after three tries it fails)
--   current      the validated draft shown in the prospect dossier
--   used         Ian pressed "Mark as used" (it does NOT mean a mail was sent: the Zoho sync stays the source of truth for sent mail)
--   superseded   replaced by a newer recommendation
--   dismissed    Ian dismissed it, or cancelled a request
--   failed       the agent could not produce a usable draft (fixed, sanitised kind only)
-- A "wait" or "no action" recommendation needs no draft and no Codex, so it is computed on the fly and never stored.

create table public.prospect_mail_recommendations (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'generating', 'current', 'used', 'superseded', 'dismissed', 'failed')),

  action_type text check (action_type in ('first_outreach', 'follow_up', 'reply', 'concept_follow_up', 'quote_follow_up', 'meeting_follow_up', 'wait', 'no_action')),
  recommended_send_at date,
  should_send_now boolean,
  subject text check (char_length(subject) <= 400),
  body text check (char_length(body) <= 6000),
  reason_summary text check (char_length(reason_summary) <= 600),
  language text check (language in ('nl', 'en')),

  -- The deterministic plan the draft was written for (action, timing, reason) and the minimal context sent to Codex. Both are written by the CRM
  -- server when the request is made; the agent can read them for its own job only and can never change them.
  plan jsonb not null,
  context jsonb not null,
  -- A fingerprint of the CRM history the recommendation is based on. When it no longer matches, the recommendation is OUTDATED.
  context_fingerprint text not null check (char_length(context_fingerprint) = 64),
  fingerprint_parts jsonb not null default '{}'::jsonb,

  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  agent_id uuid references public.prospect_agents (id) on delete set null,
  lease_expires_at timestamptz,
  attempts smallint not null default 0 check (attempts >= 0),
  failure_kind text check (char_length(failure_kind) <= 40),
  codex_ms integer check (codex_ms >= 0),
  generated_at timestamptz,
  used_at timestamptz,
  superseded_at timestamptz,
  dismissed_at timestamptz,

  check (status not in ('current', 'used') or (action_type is not null and subject is not null and body is not null and generated_at is not null)),
  check (status <> 'used' or used_at is not null),
  check (status <> 'dismissed' or dismissed_at is not null),
  check (status <> 'superseded' or superseded_at is not null)
);

-- At most one open request and one current recommendation per prospect: a double click can never queue two Codex runs.
create unique index prospect_mail_recommendations_one_open on public.prospect_mail_recommendations (prospect_id) where status in ('queued', 'generating');
create unique index prospect_mail_recommendations_one_current on public.prospect_mail_recommendations (prospect_id) where status = 'current';
create index prospect_mail_recommendations_queue_idx on public.prospect_mail_recommendations (status, requested_at) where status in ('queued', 'generating');
create index prospect_mail_recommendations_prospect_idx on public.prospect_mail_recommendations (prospect_id, requested_at desc);

alter table public.prospect_mail_recommendations enable row level security;
revoke all on public.prospect_mail_recommendations from anon, authenticated;
-- Admins read everything and may queue a request, dismiss or mark a draft used. They cannot write a subject or body: only the agent
-- functions below can produce a draft, so a recommendation always went through the server's validation.
grant select on public.prospect_mail_recommendations to authenticated;
grant insert (prospect_id, plan, context, context_fingerprint, fingerprint_parts, language, requested_by) on public.prospect_mail_recommendations to authenticated;
grant update (status, used_at, dismissed_at) on public.prospect_mail_recommendations to authenticated;
create policy "prospect_mail_recommendations: admins only" on public.prospect_mail_recommendations
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- "Mark as used" leaves a trace in the prospect's history. It is not a sent mail and is never counted as one.
alter table public.prospect_activities drop constraint prospect_activities_type_check;
alter table public.prospect_activities add constraint prospect_activities_type_check check (type in (
  'created', 'imported', 'note', 'status_changed', 'contacted', 'follow_up_sent', 'reply_received',
  'concept_sent', 'meeting_planned', 'quote_sent', 'follow_up_set', 'follow_up_done',
  'preview_linked', 'preview_unlinked', 'preview_viewed', 'project_linked', 'project_created', 'won', 'lost', 'other',
  'mail_assistant_used'
));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Functions the agent API calls (same token check as the discovery functions; SECURITY DEFINER, empty search_path).
-- ---------------------------------------------------------------------------------------------------------------------------------

-- Claim the oldest queued request. A request whose lease ran out (the agent stopped) goes back to the queue, and fails after three attempts.
create function public.agent_mail_claim(p_token text, p_lease_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_job public.prospect_mail_recommendations;
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 120), 30), 300);
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  update public.prospect_agents set last_seen_at = now() where id = v_agent;

  update public.prospect_mail_recommendations
     set status = 'failed', failure_kind = 'agent_stopped', lease_expires_at = null
   where status = 'generating' and lease_expires_at < now() and attempts >= 3;
  update public.prospect_mail_recommendations
     set status = 'queued', agent_id = null, lease_expires_at = null
   where status = 'generating' and lease_expires_at < now();

  with next as (
    select id from public.prospect_mail_recommendations
     where status = 'queued'
     order by requested_at
     limit 1
     for update skip locked
  )
  update public.prospect_mail_recommendations r
     set status = 'generating', agent_id = v_agent, lease_expires_at = now() + make_interval(secs => v_lease), attempts = r.attempts + 1
    from next
   where r.id = next.id
  returning r.* into v_job;

  if v_job.id is null then return jsonb_build_object('ok', true, 'job', null); end if;
  return jsonb_build_object('ok', true, 'job', jsonb_build_object('id', v_job.id, 'plan', v_job.plan, 'context', v_job.context, 'attempt', v_job.attempts));
end;
$$;

-- Keep the lease alive while Codex works; tells the agent when the request was dismissed so it can stop.
create function public.agent_mail_progress(p_token text, p_job uuid, p_lease_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_job public.prospect_mail_recommendations;
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 120), 30), 300);
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  select * into v_job from public.prospect_mail_recommendations where id = p_job for update;
  if v_job.id is null or v_job.agent_id is distinct from v_agent then return jsonb_build_object('ok', false, 'error', 'lease_lost'); end if;
  if v_job.status = 'dismissed' then return jsonb_build_object('ok', true, 'cancel', true); end if;
  if v_job.status <> 'generating' or v_job.lease_expires_at < now() then return jsonb_build_object('ok', false, 'error', 'lease_lost'); end if;
  update public.prospect_mail_recommendations set lease_expires_at = now() + make_interval(secs => v_lease) where id = p_job;
  update public.prospect_agents set last_seen_at = now() where id = v_agent;
  return jsonb_build_object('ok', true, 'cancel', false);
end;
$$;

-- The plan a request was made for, so the server can re-validate the agent's answer against it (not the agent's idea of it).
create function public.agent_mail_params(p_token text, p_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_job public.prospect_mail_recommendations;
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  select * into v_job from public.prospect_mail_recommendations where id = p_job;
  if v_job.id is null or v_job.agent_id is distinct from v_agent or v_job.status <> 'generating' or v_job.lease_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'lease_lost');
  end if;
  return jsonb_build_object('ok', true, 'plan', v_job.plan);
end;
$$;

-- Store the validated draft. The previous current recommendation of the same prospect is superseded in the same step.
create function public.agent_mail_submit(p_token text, p_job uuid, p_result jsonb, p_codex_ms integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_job public.prospect_mail_recommendations;
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  select * into v_job from public.prospect_mail_recommendations where id = p_job for update;
  if v_job.id is null or v_job.agent_id is distinct from v_agent or v_job.status <> 'generating' or v_job.lease_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'lease_lost');
  end if;
  update public.prospect_mail_recommendations set status = 'superseded', superseded_at = now() where prospect_id = v_job.prospect_id and status = 'current' and id <> p_job;
  update public.prospect_mail_recommendations
     set status = 'current',
         action_type = p_result ->> 'action_type',
         recommended_send_at = nullif(p_result ->> 'recommended_send_at', '')::date,
         should_send_now = coalesce((p_result ->> 'should_send_now')::boolean, false),
         subject = left(p_result ->> 'subject', 400),
         body = left(p_result ->> 'body', 6000),
         reason_summary = left(p_result ->> 'reason_summary', 600),
         language = case when v_job.plan ->> 'language' in ('nl', 'en') then v_job.plan ->> 'language' else null end,
         generated_at = now(), lease_expires_at = null, failure_kind = null,
         codex_ms = least(greatest(coalesce(p_codex_ms, 0), 0), 86400000)
   where id = p_job;
  update public.prospect_agents set last_seen_at = now(), last_failure_kind = null where id = v_agent;
  return jsonb_build_object('ok', true);
end;
$$;

-- A request that could not produce a usable draft. The kind is one of a fixed set; no raw text is stored.
create function public.agent_mail_fail(p_token text, p_job uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_job public.prospect_mail_recommendations;
  v_kind text := case when p_kind in ('codex_not_installed', 'codex_not_authenticated', 'codex_usage_limit', 'codex_timeout', 'invalid_output', 'not_allowed', 'network_error', 'agent_error', 'cancelled') then p_kind else 'agent_error' end;
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  select * into v_job from public.prospect_mail_recommendations where id = p_job for update;
  if v_job.id is null or v_job.agent_id is distinct from v_agent or v_job.status <> 'generating' then return jsonb_build_object('ok', false, 'error', 'lease_lost'); end if;
  update public.prospect_mail_recommendations set status = 'failed', failure_kind = v_kind, lease_expires_at = null where id = p_job;
  update public.prospect_agents set last_seen_at = now(), last_failure_kind = v_kind where id = v_agent;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.agent_mail_claim(text, integer), public.agent_mail_progress(text, uuid, integer), public.agent_mail_params(text, uuid),
  public.agent_mail_submit(text, uuid, jsonb, integer), public.agent_mail_fail(text, uuid, text) from public, anon, authenticated;
grant execute on function public.agent_mail_claim(text, integer), public.agent_mail_progress(text, uuid, integer), public.agent_mail_params(text, uuid),
  public.agent_mail_submit(text, uuid, jsonb, integer), public.agent_mail_fail(text, uuid, text) to anon;
