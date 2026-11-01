-- Client previews: track successful unlocks.
--
-- "Unlock" = a CORRECT access code was submitted and a session was issued. Nothing else counts: not wrong codes,
-- not page loads, assets or requests on an existing session (those never reach verify_preview_access).
-- Stored on the preview row, so it survives code resets, disable / re-enable and target changes, and goes away only
-- with the preview. No IP address, location, fingerprint or browsing history is stored.
--
-- `last_accessed_at` already existed, and `access_count` counted logins too, but both also contain the operator's own
-- test logins and their semantics were never guaranteed. History is not inferred from them: tracking starts at
-- deployment, so `last_accessed_at` is cleared and `access_count` is retired (left in place, no longer written or read).

alter table public.client_previews
  add column first_accessed_at timestamptz,
  add column successful_access_count bigint not null default 0 check (successful_access_count >= 0);

update public.client_previews set last_accessed_at = null;

grant select (first_accessed_at, successful_access_count) on public.client_previews to authenticated;
-- Writable by nobody through the API: only verify_preview_access (security definer) records an unlock.

-- Lets the CRM log "Preview viewed" on a linked prospect.
alter table public.prospect_activities drop constraint prospect_activities_type_check;
alter table public.prospect_activities add constraint prospect_activities_type_check check (type in (
  'created', 'imported', 'note', 'status_changed', 'contacted', 'follow_up_sent', 'reply_received',
  'concept_sent', 'meeting_planned', 'quote_sent', 'follow_up_set', 'follow_up_done',
  'preview_linked', 'preview_unlinked', 'preview_viewed', 'project_linked', 'project_created', 'won', 'lost', 'other'
));

create or replace function public.verify_preview_access(p_subdomain text, p_code text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.client_previews;
  ip_failures integer;
  preview_failures integer;
  first_unlock integer;
  window_start constant timestamptz := now() - interval '15 minutes';
begin
  if p_subdomain is null or char_length(p_subdomain) > 63
     or p_code is null or char_length(p_code) = 0 or char_length(p_code) > 200
     or p_ip_hash is null or char_length(p_ip_hash) = 0 or char_length(p_ip_hash) > 128 then
    return jsonb_build_object('result', 'denied');
  end if;

  select * into p from public.client_previews where subdomain = lower(p_subdomain);
  if not found then
    return jsonb_build_object('result', 'missing');
  end if;
  if not p.active or (p.expires_at is not null and p.expires_at <= now()) then
    return jsonb_build_object('result', 'unavailable');
  end if;

  -- Housekeeping: old attempts are irrelevant.
  if random() < 0.05 then
    delete from public.preview_access_attempts where attempted_at < now() - interval '1 day';
  end if;

  select count(*) into ip_failures
    from public.preview_access_attempts
   where preview_id = p.id and ip_hash = p_ip_hash and attempted_at > window_start;
  select count(*) into preview_failures
    from public.preview_access_attempts
   where preview_id = p.id and attempted_at > window_start;

  -- 5 failures per visitor and 40 per preview per 15 minutes. Never locks permanently.
  if ip_failures >= 5 or preview_failures >= 40 then
    return jsonb_build_object('result', 'limited');
  end if;

  if extensions.crypt(p_code, p.access_code_hash) = p.access_code_hash then
    delete from public.preview_access_attempts where preview_id = p.id and ip_hash = p_ip_hash;

    -- Atomic and race-free: the row lock makes exactly one concurrent unlock "the first", and every increment is a
    -- single in-place UPDATE (never read-modify-write in the application).
    update public.client_previews
       set first_accessed_at = now()
     where id = p.id and first_accessed_at is null;
    get diagnostics first_unlock = row_count;

    update public.client_previews
       set last_accessed_at = now(), successful_access_count = successful_access_count + 1
     where id = p.id;

    -- The first unlock leaves ONE note on a linked prospect (never one per login).
    if first_unlock > 0 then
      insert into public.prospect_activities (prospect_id, type, title, description, metadata)
      select pr.id, 'preview_viewed', 'Preview viewed',
             'Client accessed the protected preview for the first time.',
             jsonb_build_object('subdomain', p.subdomain)
        from public.prospects pr
       where pr.linked_preview_id = p.id;
    end if;

    return jsonb_build_object(
      'result', 'ok',
      'id', p.id,
      'session_version', p.session_version,
      'session_ttl_hours', p.session_ttl_hours,
      'expires_at', p.expires_at
    );
  end if;

  insert into public.preview_access_attempts (preview_id, ip_hash) values (p.id, p_ip_hash);
  return jsonb_build_object('result', 'denied');
end;
$$;
