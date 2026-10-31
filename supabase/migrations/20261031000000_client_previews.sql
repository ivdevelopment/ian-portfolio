-- P5: protected client previews (access-code gated subdomains served by the preview gateway).
--
-- Design notes
-- * The access code is NEVER stored: only a bcrypt hash (pgcrypto, cost 12), computed and
--   verified INSIDE the database. The hash column is not readable through the API by anyone
--   (no column grant), and the public gateway only ever calls SECURITY DEFINER functions that
--   answer "ok / denied / limited" - so the hash cannot be pulled out for offline guessing.
-- * Failed attempts are rate limited per (preview, hashed IP) and per preview, before any
--   hashing work is done. No raw IP address is ever stored.
-- * Sessions are stateless signed cookies in the gateway; `session_version` is bumped on a code
--   reset or when a preview is disabled, which invalidates every previously issued session.
-- * Deleting a preview only removes access; it never touches the client's own deployment.
-- * Forward compatible (no schema change needed): comments / approvals / versions can reference
--   client_previews(id); a provisioning integration can add columns such as `provider` later.

create extension if not exists pgcrypto with schema extensions;

------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------
create table public.client_previews (
  id uuid primary key default gen_random_uuid(),
  client_name text not null check (char_length(client_name) between 1 and 120),
  project_name text not null check (char_length(project_name) between 1 and 120),
  -- A single hostname label ("geertkips" for geertkips.ianverlinden.com).
  subdomain text not null unique
    check (
      subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
      and subdomain <> all (array[
        'www', 'admin', 'api', 'mail', 'webmail', 'smtp', 'imap', 'pop', 'mx', 'ns', 'ns1', 'ns2',
        'dns', 'ftp', 'cpanel', 'autodiscover', 'autoconfig', 'zmail', 'en', 'nl', 'review',
        'reviews', 'work', 'contact', 'about', 'services', 'app', 'dashboard', 'login', 'preview',
        'previews', 'gateway', 'staging', 'dev', 'test', 'cdn', 'static', 'assets', 'media',
        'status', 'support', 'help', 'docs', 'blog', 'shop'
      ])
    ),
  -- The real site this preview shows. https only; the application validates it further (SSRF).
  target_url text not null
    check (target_url ~* '^https://[a-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$' and char_length(target_url) <= 500),
  access_code_hash text not null,
  active boolean not null default true,
  expires_at timestamptz,
  session_ttl_hours integer not null default 168 check (session_ttl_hours between 1 and 720),
  session_version integer not null default 1,
  last_accessed_at timestamptz,
  access_count integer not null default 0,
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.preview_access_attempts (
  id bigint generated always as identity primary key,
  preview_id uuid not null references public.client_previews (id) on delete cascade,
  ip_hash text not null check (char_length(ip_hash) <= 128),
  attempted_at timestamptz not null default now()
);
create index preview_access_attempts_lookup on public.preview_access_attempts (preview_id, ip_hash, attempted_at);
create index preview_access_attempts_recent on public.preview_access_attempts (attempted_at);

create trigger client_previews_set_updated_at before update on public.client_previews
  for each row execute function public.set_updated_at();

-- Disabling a preview (or re-pointing it) must kill existing sessions even if it is enabled again later.
create function public.client_previews_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.active and not new.active) or new.subdomain <> old.subdomain or new.target_url <> old.target_url then
    new.session_version := old.session_version + 1;
  end if;
  return new;
end;
$$;
revoke all on function public.client_previews_before_update() from public, anon, authenticated;
create trigger client_previews_before_update before update on public.client_previews
  for each row execute function public.client_previews_before_update();

------------------------------------------------------------------------
-- Privileges: nobody reads the hash. The gateway uses the functions below.
------------------------------------------------------------------------
alter table public.client_previews enable row level security;
alter table public.preview_access_attempts enable row level security;

revoke all on public.client_previews, public.preview_access_attempts from anon, authenticated;
grant select (
  id, client_name, project_name, subdomain, target_url, active, expires_at, session_ttl_hours,
  session_version, last_accessed_at, access_count, notes, created_at, updated_at
) on public.client_previews to authenticated;
grant update (
  client_name, project_name, subdomain, target_url, active, expires_at, session_ttl_hours, notes
) on public.client_previews to authenticated;
grant delete on public.client_previews to authenticated;

create policy "client_previews: admins full access" on public.client_previews
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
-- preview_access_attempts: no policies at all (functions only).

------------------------------------------------------------------------
-- Gateway functions (callable by the anonymous role, answer with minimum information)
------------------------------------------------------------------------

-- Current state of a preview by subdomain. No target URL, no hash.
create function public.preview_gate(p_subdomain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.client_previews;
begin
  if p_subdomain is null or char_length(p_subdomain) > 63 then
    return jsonb_build_object('state', 'missing');
  end if;

  select * into p from public.client_previews where subdomain = lower(p_subdomain);
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  if not p.active then
    return jsonb_build_object('state', 'inactive');
  end if;
  if p.expires_at is not null and p.expires_at <= now() then
    return jsonb_build_object('state', 'expired');
  end if;

  return jsonb_build_object(
    'state', 'ok',
    'id', p.id,
    'session_version', p.session_version,
    'session_ttl_hours', p.session_ttl_hours,
    'expires_at', p.expires_at
  );
end;
$$;

-- The target of an authorised session. Null unless the preview is active, unexpired and the
-- session generation still matches.
create function public.preview_target(p_id uuid, p_session_version integer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.target_url
    from public.client_previews p
   where p.id = p_id
     and p.active
     and (p.expires_at is null or p.expires_at > now())
     and p.session_version = p_session_version;
$$;

-- Checks an access code. Rate limited before any hashing. Result is one of:
-- ok | denied | limited | unavailable | missing
create function public.verify_preview_access(p_subdomain text, p_code text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.client_previews;
  ip_failures integer;
  preview_failures integer;
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
    update public.client_previews
       set last_accessed_at = now(), access_count = access_count + 1
     where id = p.id;
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

revoke all on function public.preview_gate(text) from public;
revoke all on function public.preview_target(uuid, integer) from public;
revoke all on function public.verify_preview_access(text, text, text) from public;
grant execute on function public.preview_gate(text) to anon, authenticated;
grant execute on function public.preview_target(uuid, integer) to anon, authenticated;
grant execute on function public.verify_preview_access(text, text, text) to anon, authenticated;

------------------------------------------------------------------------
-- Admin functions (the only way a code is ever written)
------------------------------------------------------------------------
create function public.create_client_preview(
  p_client_name text,
  p_project_name text,
  p_subdomain text,
  p_target_url text,
  p_code text,
  p_expires_at timestamptz,
  p_session_ttl_hours integer,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_code is null or char_length(p_code) < 10 or char_length(p_code) > 128 then
    raise exception 'access code must be 10-128 characters' using errcode = '22023';
  end if;

  insert into public.client_previews (
    client_name, project_name, subdomain, target_url, access_code_hash,
    expires_at, session_ttl_hours, notes
  ) values (
    p_client_name, p_project_name, lower(p_subdomain), p_target_url,
    extensions.crypt(p_code, extensions.gen_salt('bf', 12)),
    p_expires_at, coalesce(p_session_ttl_hours, 168), nullif(p_notes, '')
  )
  returning id into new_id;
  return new_id;
end;
$$;

-- Replaces the code and invalidates every existing session.
create function public.reset_preview_access_code(p_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_code is null or char_length(p_code) < 10 or char_length(p_code) > 128 then
    raise exception 'access code must be 10-128 characters' using errcode = '22023';
  end if;

  update public.client_previews
     set access_code_hash = extensions.crypt(p_code, extensions.gen_salt('bf', 12)),
         session_version = session_version + 1
   where id = p_id;
  if not found then
    raise exception 'preview not found' using errcode = 'P0002';
  end if;
  -- A fresh code also clears the brute-force counters.
  delete from public.preview_access_attempts where preview_id = p_id;
end;
$$;

revoke all on function public.create_client_preview(text, text, text, text, text, timestamptz, integer, text) from public, anon;
revoke all on function public.reset_preview_access_code(uuid, text) from public, anon;
grant execute on function public.create_client_preview(text, text, text, text, text, timestamptz, integer, text) to authenticated;
grant execute on function public.reset_preview_access_code(uuid, text) to authenticated;
