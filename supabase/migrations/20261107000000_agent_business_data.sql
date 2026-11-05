-- P10.2: the local agent reports the state of its local business data (an OpenStreetMap index kept on the agent's PC) so the CRM can show
-- "Business data: Local Belgium index · updated 2 days ago". Only a small summary is stored: no paths, no business records.
-- Also adds the failure kind `business_data_missing` (the local index is not installed yet) to agent_fail.

alter table public.prospect_agents
  add column business_data jsonb check (business_data is null or (jsonb_typeof(business_data) = 'object' and pg_column_size(business_data) <= 1000));
grant select (business_data) on public.prospect_agents to authenticated;

-- The heartbeat gains one optional argument, so the old four-argument function is replaced (an agent that sends no business data still works).
drop function public.agent_heartbeat(text, text, text, text);
create function public.agent_heartbeat(p_token text, p_codex_version text, p_codex_state text, p_failure text, p_business_data jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_name text;
  v_data jsonb := null;
begin
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  -- Whitelisted, length-limited fields only; anything else the agent sends is dropped.
  if p_business_data is not null and jsonb_typeof(p_business_data) = 'object' then
    v_data := jsonb_strip_nulls(jsonb_build_object(
      'state', case when p_business_data ->> 'state' in ('ready', 'missing') then p_business_data ->> 'state' else 'missing' end,
      'source', left(p_business_data ->> 'source', 60),
      'data_date', case when (p_business_data ->> 'data_date') ~ '^\d{4}-\d{2}-\d{2}' then left(p_business_data ->> 'data_date', 40) else null end,
      'businesses', case when (p_business_data ->> 'businesses') ~ '^\d{1,9}$' then (p_business_data ->> 'businesses')::integer else null end,
      'freshness', case when p_business_data ->> 'freshness' in ('fresh', 'aging', 'stale', 'unknown') then p_business_data ->> 'freshness' else 'unknown' end));
  end if;
  update public.prospect_agents
     set last_seen_at = now(),
         codex_version = left(p_codex_version, 60),
         codex_state = case when p_codex_state in ('ready', 'not_installed', 'not_authenticated', 'error') then p_codex_state else null end,
         last_failure_kind = left(p_failure, 40),
         business_data = coalesce(v_data, business_data)
   where id = v_agent
  returning display_name into v_name;
  return jsonb_build_object('ok', true, 'device', v_name);
end;
$$;
revoke all on function public.agent_heartbeat(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.agent_heartbeat(text, text, text, text, jsonb) to anon;

-- Same function as before with one more accepted failure kind.
create or replace function public.agent_fail(p_token text, p_run uuid, p_kind text, p_message text, p_status text default 'failed')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.agent_resolve(p_token);
  v_run public.prospect_discovery_runs;
  v_name text;
  v_kind text := case when p_kind in ('codex_not_installed', 'codex_not_authenticated', 'codex_usage_limit', 'codex_timeout', 'invalid_output', 'network_error', 'source_error', 'business_data_missing', 'agent_error', 'cancelled')
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
