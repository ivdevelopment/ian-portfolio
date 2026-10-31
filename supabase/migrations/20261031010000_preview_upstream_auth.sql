-- Client previews: per-preview upstream authentication.
--
-- A client's origin (for example a Cloudflare Worker on workers.dev) is publicly reachable and would
-- bypass the gateway. The origin can require a shared secret in a request header; the gateway sends it
-- only to THAT preview's origin. The secret itself never lives in the database: a preview only stores
-- the header NAME and a REFERENCE (`upstream_secret_ref`); the gateway resolves the reference to a value
-- in its own environment (PREVIEW_UPSTREAM_SECRET_<REF>), so different previews can use different
-- credentials and a database leak reveals no secret.
--
-- Also replaces `preview_target` (text) by `preview_upstream` (jsonb: target + upstream auth settings).

alter table public.client_previews
  add column upstream_auth_type text not null default 'none'
    check (upstream_auth_type in ('none', 'header')),
  add column upstream_header_name text
    check (upstream_header_name ~ '^[a-z][a-z0-9-]{2,62}$'),
  add column upstream_secret_ref text
    check (upstream_secret_ref ~ '^[a-z][a-z0-9_]{0,39}$'),
  add constraint client_previews_upstream_auth_complete
    check (upstream_auth_type = 'none' or (upstream_header_name is not null and upstream_secret_ref is not null));

-- Re-pointing a preview, or changing how it authenticates upstream, ends existing sessions.
create or replace function public.client_previews_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.active and not new.active)
     or new.subdomain <> old.subdomain
     or new.target_url <> old.target_url
     or new.upstream_auth_type <> old.upstream_auth_type
     or new.upstream_header_name is distinct from old.upstream_header_name
     or new.upstream_secret_ref is distinct from old.upstream_secret_ref then
    new.session_version := old.session_version + 1;
  end if;
  return new;
end;
$$;

-- Names only (never a value); readable and writable by admins like the other settings.
grant select (upstream_auth_type, upstream_header_name, upstream_secret_ref) on public.client_previews to authenticated;
grant update (upstream_auth_type, upstream_header_name, upstream_secret_ref) on public.client_previews to authenticated;

-- Where an authorised session is proxied to, and how. Null unless the preview is active, unexpired and
-- the session generation still matches. Evaluated on every request: nothing here is cached.
create function public.preview_upstream(p_id uuid, p_session_version integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'target_url', p.target_url,
           'auth_type', p.upstream_auth_type,
           'header_name', p.upstream_header_name,
           'secret_ref', p.upstream_secret_ref
         )
    from public.client_previews p
   where p.id = p_id
     and p.active
     and (p.expires_at is null or p.expires_at > now())
     and p.session_version = p_session_version;
$$;

revoke all on function public.preview_upstream(uuid, integer) from public;
grant execute on function public.preview_upstream(uuid, integer) to anon, authenticated;

drop function public.preview_target(uuid, integer);
