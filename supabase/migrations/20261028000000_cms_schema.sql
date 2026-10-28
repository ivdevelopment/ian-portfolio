-- P1 CMS schema: projects, media, features, inquiries, admin authorisation,
-- row level security and the project-media storage bucket.

------------------------------------------------------------------------
-- Enumerations
------------------------------------------------------------------------
create type public.project_kind as enum ('website', 'web-app', 'redesign', 'concept');
create type public.project_type as enum ('client', 'personal', 'concept');
create type public.preview_mode as enum ('embed', 'media', 'external');
create type public.media_type as enum ('image', 'gif', 'video');
create type public.inquiry_status as enum ('new', 'contacted', 'qualified', 'won', 'lost', 'archived');

------------------------------------------------------------------------
-- Admin authorisation
-- One row per approved admin. There is NO public sign-up; rows are added
-- manually (see README: "Creating the first admin").
------------------------------------------------------------------------
create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

------------------------------------------------------------------------
-- Projects
------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (char_length(slug) between 1 and 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 120),
  subtitle text check (char_length(subtitle) <= 160),
  short_description text not null check (char_length(short_description) between 1 and 400),
  description text check (char_length(description) <= 8000),
  category text not null check (char_length(category) between 1 and 80),
  kind public.project_kind not null default 'website',
  year smallint check (year between 1990 and 2100),
  client text check (char_length(client) <= 120),
  project_type public.project_type,
  -- Storage path inside `project-media`, an https:// URL, or an app-relative "/media/…" path.
  thumbnail_path text,
  tags text[] not null default '{}',
  technologies text[] not null default '{}',

  live_url text check (live_url ~* '^https?://'),
  preview_url text check (preview_url ~* '^https?://'),
  github_url text check (github_url ~* '^https?://'),
  preview_mode public.preview_mode not null default 'media',

  featured boolean not null default false,
  published boolean not null default false,
  -- Sample / placeholder content that must be clearly labelled publicly.
  is_example boolean not null default false,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index projects_public_idx on public.projects (published, sort_order);

create function public.projects_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  if new.published then
    if new.published_at is null then
      new.published_at = now();
    end if;
  else
    new.published_at = null;
  end if;
  return new;
end;
$$;

revoke all on function public.projects_before_write() from public, anon, authenticated;

create trigger projects_before_write
  before insert or update on public.projects
  for each row execute function public.projects_before_write();

------------------------------------------------------------------------
-- Project media (images, GIFs, videos)
------------------------------------------------------------------------
create table public.project_media (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  type public.media_type not null,
  storage_path text,
  external_url text check (external_url ~* '^(https://|/)'),
  alt text check (char_length(alt) <= 300),
  poster_path text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  -- exactly one source
  constraint project_media_one_source check ((storage_path is null) <> (external_url is null))
);

create index project_media_project_idx on public.project_media (project_id, sort_order);

-- Deleting the media row that is the thumbnail clears the thumbnail.
create function public.project_media_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.projects
     set thumbnail_path = null
   where id = old.project_id
     and thumbnail_path is not null
     and thumbnail_path in (old.storage_path, old.external_url);
  return old;
end;
$$;

revoke all on function public.project_media_after_delete() from public, anon, authenticated;

create trigger project_media_after_delete
  after delete on public.project_media
  for each row execute function public.project_media_after_delete();

------------------------------------------------------------------------
-- Project features (bullet list)
------------------------------------------------------------------------
create table public.project_features (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 160),
  sort_order integer not null default 0
);

create index project_features_project_idx on public.project_features (project_id, sort_order);

------------------------------------------------------------------------
-- Inquiries (contact form). Never readable by the public.
------------------------------------------------------------------------
create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  email text not null
    check (char_length(email) between 3 and 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  project_type text not null check (char_length(project_type) between 1 and 60),
  budget text not null check (char_length(budget) between 1 and 60),
  message text not null check (char_length(message) between 20 and 4000),
  status public.inquiry_status not null default 'new',
  -- Salted hash used only for rate limiting. Never selected by the admin UI.
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inquiries_created_idx on public.inquiries (created_at desc);
create index inquiries_status_idx on public.inquiries (status);
create index inquiries_rate_idx on public.inquiries (ip_hash, created_at);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger inquiries_set_updated_at
  before update on public.inquiries
  for each row execute function public.set_updated_at();

-- The only way the public can create an inquiry. Anonymous visitors get no
-- table privileges at all; this function validates (via the table's CHECK
-- constraints) and applies a simple rate limit.
create function public.submit_inquiry(
  p_name text,
  p_email text,
  p_project_type text,
  p_budget text,
  p_message text,
  p_ip_hash text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ip_hash is not null and (
    select count(*) from public.inquiries
     where ip_hash = p_ip_hash and created_at > now() - interval '1 hour'
  ) >= 5 then
    return 'rate_limited';
  end if;

  -- Global flood cap.
  if (
    select count(*) from public.inquiries where created_at > now() - interval '1 hour'
  ) >= 100 then
    return 'rate_limited';
  end if;

  insert into public.inquiries (name, email, project_type, budget, message, ip_hash)
  values (p_name, p_email, p_project_type, p_budget, p_message, p_ip_hash);

  return 'ok';
end;
$$;

revoke all on function public.submit_inquiry(text, text, text, text, text, text) from public;
grant execute on function public.submit_inquiry(text, text, text, text, text, text) to anon, authenticated;

------------------------------------------------------------------------
-- Atomic project save (security INVOKER: RLS still applies, and the
-- function additionally refuses non-admins).
------------------------------------------------------------------------
create function public.save_project(
  p_id uuid,
  p_project jsonb,
  p_features jsonb,
  p_media jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.projects (
    id, slug, title, subtitle, short_description, description, category, kind,
    year, client, project_type, thumbnail_path, tags, technologies,
    live_url, preview_url, github_url, preview_mode,
    featured, published, is_example, sort_order
  )
  values (
    p_id,
    p_project->>'slug',
    p_project->>'title',
    nullif(p_project->>'subtitle', ''),
    p_project->>'short_description',
    nullif(p_project->>'description', ''),
    p_project->>'category',
    (p_project->>'kind')::public.project_kind,
    nullif(p_project->>'year', '')::smallint,
    nullif(p_project->>'client', ''),
    nullif(p_project->>'project_type', '')::public.project_type,
    nullif(p_project->>'thumbnail_path', ''),
    coalesce(array(select jsonb_array_elements_text(p_project->'tags')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p_project->'technologies')), '{}'),
    nullif(p_project->>'live_url', ''),
    nullif(p_project->>'preview_url', ''),
    nullif(p_project->>'github_url', ''),
    (p_project->>'preview_mode')::public.preview_mode,
    (p_project->>'featured')::boolean,
    (p_project->>'published')::boolean,
    coalesce((p_project->>'is_example')::boolean, false),
    coalesce((p_project->>'sort_order')::integer, 0)
  )
  on conflict (id) do update set
    slug = excluded.slug,
    title = excluded.title,
    subtitle = excluded.subtitle,
    short_description = excluded.short_description,
    description = excluded.description,
    category = excluded.category,
    kind = excluded.kind,
    year = excluded.year,
    client = excluded.client,
    project_type = excluded.project_type,
    thumbnail_path = excluded.thumbnail_path,
    tags = excluded.tags,
    technologies = excluded.technologies,
    live_url = excluded.live_url,
    preview_url = excluded.preview_url,
    github_url = excluded.github_url,
    preview_mode = excluded.preview_mode,
    featured = excluded.featured,
    published = excluded.published,
    is_example = excluded.is_example,
    sort_order = excluded.sort_order;

  -- Features: replace wholesale (they are a small ordered list).
  delete from public.project_features where project_id = p_id;
  insert into public.project_features (project_id, label, sort_order)
  select p_id, f.label, (f.ord - 1)::integer
    from jsonb_array_elements_text(p_features) with ordinality as f(label, ord);

  -- Media: drop rows that were removed in the editor, upsert the rest in order.
  delete from public.project_media
   where project_id = p_id
     and id not in (
       select (m->>'id')::uuid from jsonb_array_elements(p_media) as m
     );

  insert into public.project_media (id, project_id, type, storage_path, external_url, alt, poster_path, sort_order)
  select
    (m.value->>'id')::uuid,
    p_id,
    (m.value->>'type')::public.media_type,
    nullif(m.value->>'storage_path', ''),
    nullif(m.value->>'external_url', ''),
    nullif(m.value->>'alt', ''),
    nullif(m.value->>'poster_path', ''),
    (m.ord - 1)::integer
  from jsonb_array_elements(p_media) with ordinality as m(value, ord)
  on conflict (id) do update set
    type = excluded.type,
    storage_path = excluded.storage_path,
    external_url = excluded.external_url,
    alt = excluded.alt,
    poster_path = excluded.poster_path,
    sort_order = excluded.sort_order
  where public.project_media.project_id = p_id;

  return p_id;
end;
$$;

revoke all on function public.save_project(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_project(uuid, jsonb, jsonb, jsonb) to authenticated;

------------------------------------------------------------------------
-- Privileges: explicit and minimal. RLS below does the row filtering.
------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.projects, public.project_media, public.project_features to anon, authenticated;
grant insert, update, delete on public.projects, public.project_media, public.project_features to authenticated;
grant select, update, delete on public.inquiries to authenticated;
grant select on public.admin_users to authenticated;

------------------------------------------------------------------------
-- Row level security
------------------------------------------------------------------------
alter table public.admin_users enable row level security;
alter table public.projects enable row level security;
alter table public.project_media enable row level security;
alter table public.project_features enable row level security;
alter table public.inquiries enable row level security;

-- admin_users: an authenticated user may only see their own row (so the app can
-- confirm membership). No insert/update/delete policies: managed out-of-band.
create policy "admin_users: read own row"
  on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

-- projects
create policy "projects: public reads published"
  on public.projects for select to anon, authenticated
  using (published = true);

create policy "projects: admins full access"
  on public.projects for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- project_media
create policy "project_media: public reads media of published projects"
  on public.project_media for select to anon, authenticated
  using (exists (
    select 1 from public.projects p where p.id = project_id and p.published = true
  ));

create policy "project_media: admins full access"
  on public.project_media for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- project_features
create policy "project_features: public reads features of published projects"
  on public.project_features for select to anon, authenticated
  using (exists (
    select 1 from public.projects p where p.id = project_id and p.published = true
  ));

create policy "project_features: admins full access"
  on public.project_features for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- inquiries: admins only. Public inserts go through submit_inquiry().
create policy "inquiries: admins full access"
  on public.inquiries for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

------------------------------------------------------------------------
-- Storage: public-read bucket, admin-only writes.
-- Limits are enforced by Storage itself (size + MIME), and again in the app.
------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-media',
  'project-media',
  true,
  52428800, -- 50 MiB (largest allowed: video)
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "project-media: admins list and read"
  on storage.objects for select to authenticated
  using (bucket_id = 'project-media' and (select public.is_admin()));

create policy "project-media: admins upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'project-media' and (select public.is_admin()));

create policy "project-media: admins update"
  on storage.objects for update to authenticated
  using (bucket_id = 'project-media' and (select public.is_admin()))
  with check (bucket_id = 'project-media' and (select public.is_admin()));

create policy "project-media: admins delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'project-media' and (select public.is_admin()));
