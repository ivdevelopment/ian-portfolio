-- P2: reviews, review invitations, site content CMS, services, skills,
-- site-media bucket. Builds on the P1 schema (is_admin(), RLS conventions).

------------------------------------------------------------------------
-- Reviews
------------------------------------------------------------------------
create type public.review_status as enum ('pending', 'approved', 'rejected', 'archived');
create type public.review_source as enum ('admin', 'invitation');

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  company text check (char_length(company) <= 120),
  role text check (char_length(role) <= 120),
  rating integer not null check (rating between 1 and 5),
  -- The text that is displayed publicly (admins may edit it).
  review_text text not null check (char_length(review_text) between 1 and 4000),
  avatar_path text
    check (avatar_path ~ '^reviews/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  status public.review_status not null default 'pending',
  source public.review_source not null,
  featured boolean not null default false,
  sort_order integer not null default 0,
  submitted_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reviews_public_idx on public.reviews (status, featured desc, sort_order, published_at desc);
create index reviews_project_idx on public.reviews (project_id);

create function public.reviews_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  if new.status = 'approved' then
    if new.published_at is null then
      new.published_at = now();
    end if;
  else
    new.published_at = null;
  end if;
  return new;
end;
$$;

revoke all on function public.reviews_before_write() from public, anon, authenticated;

create trigger reviews_before_write
  before insert or update on public.reviews
  for each row execute function public.reviews_before_write();

-- Data that must never be public, even for approved reviews: the client's
-- original words (the displayed text may be edited) and the rate-limit hash.
create table public.review_private (
  review_id uuid primary key references public.reviews (id) on delete cascade,
  original_review_text text not null check (char_length(original_review_text) between 1 and 4000),
  ip_hash text,
  created_at timestamptz not null default now()
);

create index review_private_rate_idx on public.review_private (ip_hash, created_at);

------------------------------------------------------------------------
-- Review invitations. Only the SHA-256 hash of the token is stored.
------------------------------------------------------------------------
create table public.review_invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  email text check (char_length(email) <= 200),
  client_name text check (char_length(client_name) <= 120),
  project_id uuid references public.projects (id) on delete set null,
  review_id uuid references public.reviews (id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index review_invitations_created_idx on public.review_invitations (created_at desc);

-- Public: look up what to show on the review form. Returns NULL for any token
-- that is unknown, expired, revoked or used — callers cannot tell which.
create function public.get_review_invitation(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'client_name', i.client_name,
    'project_title', p.title,
    'project_thumbnail', coalesce(
      p.thumbnail_path,
      (select coalesce(m.storage_path, m.external_url)
         from public.project_media m
        where m.project_id = p.id and m.type <> 'video'
        order by m.sort_order
        limit 1)
    )
  )
  from public.review_invitations i
  left join public.projects p on p.id = i.project_id and p.published
  where i.token_hash = p_token_hash
    and i.used_at is null
    and i.revoked_at is null
    and i.expires_at > now();
$$;

-- Public: submit a review. One atomic step: the invitation is consumed by a
-- conditional UPDATE (so two concurrent submissions cannot both succeed), and
-- the review rows are inserted in the same transaction. If the insert fails
-- (e.g. constraint violation) the invitation is NOT consumed.
create function public.submit_review(
  p_token_hash text,
  p_name text,
  p_company text,
  p_role text,
  p_rating integer,
  p_text text,
  p_ip_hash text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.review_invitations;
  v_review_id uuid;
begin
  if p_ip_hash is not null and (
    select count(*) from public.review_private
     where ip_hash = p_ip_hash and created_at > now() - interval '1 hour'
  ) >= 5 then
    return 'rate_limited';
  end if;

  update public.review_invitations
     set used_at = now()
   where token_hash = p_token_hash
     and used_at is null
     and revoked_at is null
     and expires_at > now()
  returning * into v_inv;

  if not found then
    return 'invalid';
  end if;

  insert into public.reviews (project_id, name, company, role, rating, review_text, status, source, submitted_at)
  values (
    v_inv.project_id,
    p_name,
    nullif(p_company, ''),
    nullif(p_role, ''),
    p_rating,
    p_text,
    'pending',
    'invitation',
    now()
  )
  returning id into v_review_id;

  insert into public.review_private (review_id, original_review_text, ip_hash)
  values (v_review_id, p_text, p_ip_hash);

  update public.review_invitations set review_id = v_review_id where id = v_inv.id;

  return 'ok';
end;
$$;

revoke all on function public.get_review_invitation(text) from public;
revoke all on function public.submit_review(text, text, text, text, integer, text, text) from public;
grant execute on function public.get_review_invitation(text) to anon, authenticated;
grant execute on function public.submit_review(text, text, text, text, integer, text, text) to anon, authenticated;

------------------------------------------------------------------------
-- Site content CMS (structured, not a page builder)
------------------------------------------------------------------------
create table public.site_settings (
  id boolean primary key default true check (id),
  site_name text not null check (char_length(site_name) between 1 and 80),
  display_name text not null check (char_length(display_name) between 1 and 80),
  location text check (char_length(location) <= 120),
  contact_email text check (char_length(contact_email) <= 200),
  github_url text check (github_url ~* '^https://'),
  linkedin_url text check (linkedin_url ~* '^https://'),
  instagram_url text check (instagram_url ~* '^https://'),
  x_url text check (x_url ~* '^https://'),
  seo_default_title text not null check (char_length(seo_default_title) between 1 and 120),
  seo_title_template text not null
    check (char_length(seo_title_template) between 3 and 120 and position('%s' in seo_title_template) > 0),
  seo_default_description text not null check (char_length(seo_default_description) between 1 and 320),
  seo_og_title text check (char_length(seo_og_title) <= 120),
  updated_at timestamptz not null default now()
);

create table public.site_content (
  key text primary key check (key in ('home', 'about', 'contact')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title text not null check (char_length(title) between 1 and 80),
  description text not null check (char_length(description) between 1 and 300),
  -- Controlled identifier mapped to a bundled icon; never raw SVG/HTML.
  icon text not null default 'design'
    check (icon in ('design', 'development', 'redesign', 'maintenance', 'performance', 'seo', 'cms', 'support', 'strategy', 'ecommerce')),
  includes text[] not null default '{}',
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  icon text check (char_length(icon) <= 40),
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger site_settings_set_updated_at before update on public.site_settings
  for each row execute function public.set_updated_at();
create trigger site_content_set_updated_at before update on public.site_content
  for each row execute function public.set_updated_at();
create trigger services_set_updated_at before update on public.services
  for each row execute function public.set_updated_at();
create trigger skills_set_updated_at before update on public.skills
  for each row execute function public.set_updated_at();

-- Transactional "save the whole list": removed rows are deleted, the rest upserted in order.
create function public.save_services(p_services jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.services
   where id not in (select (s->>'id')::uuid from jsonb_array_elements(p_services) as s);

  insert into public.services (id, slug, title, description, icon, includes, enabled, sort_order)
  select
    (s.value->>'id')::uuid,
    s.value->>'slug',
    s.value->>'title',
    s.value->>'description',
    s.value->>'icon',
    coalesce(array(select jsonb_array_elements_text(s.value->'includes')), '{}'),
    (s.value->>'enabled')::boolean,
    (s.ord - 1)::integer
  from jsonb_array_elements(p_services) with ordinality as s(value, ord)
  on conflict (id) do update set
    slug = excluded.slug,
    title = excluded.title,
    description = excluded.description,
    icon = excluded.icon,
    includes = excluded.includes,
    enabled = excluded.enabled,
    sort_order = excluded.sort_order;
end;
$$;

create function public.save_skills(p_skills jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.skills
   where id not in (select (s->>'id')::uuid from jsonb_array_elements(p_skills) as s);

  insert into public.skills (id, name, enabled, sort_order)
  select
    (s.value->>'id')::uuid,
    s.value->>'name',
    (s.value->>'enabled')::boolean,
    (s.ord - 1)::integer
  from jsonb_array_elements(p_skills) with ordinality as s(value, ord)
  on conflict (id) do update set
    name = excluded.name,
    enabled = excluded.enabled,
    sort_order = excluded.sort_order;
end;
$$;

revoke all on function public.save_services(jsonb) from public, anon;
revoke all on function public.save_skills(jsonb) from public, anon;
grant execute on function public.save_services(jsonb) to authenticated;
grant execute on function public.save_skills(jsonb) to authenticated;

------------------------------------------------------------------------
-- Privileges and RLS for the new tables (explicit, minimal)
------------------------------------------------------------------------
revoke all on public.reviews, public.review_private, public.review_invitations,
  public.site_settings, public.site_content, public.services, public.skills
  from anon, authenticated;

grant select on public.reviews, public.site_settings, public.site_content,
  public.services, public.skills to anon, authenticated;
grant insert, update, delete on public.reviews, public.site_settings, public.site_content,
  public.services, public.skills to authenticated;
grant select, insert, update, delete on public.review_private to authenticated;
grant select, insert, update, delete on public.review_invitations to authenticated;

alter table public.reviews enable row level security;
alter table public.review_private enable row level security;
alter table public.review_invitations enable row level security;
alter table public.site_settings enable row level security;
alter table public.site_content enable row level security;
alter table public.services enable row level security;
alter table public.skills enable row level security;

-- reviews: the public only ever sees approved ones.
create policy "reviews: public reads approved"
  on public.reviews for select to anon, authenticated
  using (status = 'approved');

create policy "reviews: admins full access"
  on public.reviews for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- review_private / review_invitations: admins only. No public policy at all.
create policy "review_private: admins full access"
  on public.review_private for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "review_invitations: admins full access"
  on public.review_invitations for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin() and created_by = (select auth.uid())));

-- site content: public read, admin write.
create policy "site_settings: public read"
  on public.site_settings for select to anon, authenticated using (true);
create policy "site_settings: admins full access"
  on public.site_settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "site_content: public read"
  on public.site_content for select to anon, authenticated using (true);
create policy "site_content: admins full access"
  on public.site_content for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "services: public reads enabled"
  on public.services for select to anon, authenticated using (enabled = true);
create policy "services: admins full access"
  on public.services for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "skills: public reads enabled"
  on public.skills for select to anon, authenticated using (enabled = true);
create policy "skills: admins full access"
  on public.skills for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

------------------------------------------------------------------------
-- Storage: site-media (review avatars + site content images). Public read,
-- admin-only writes, images only.
------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-media',
  'site-media',
  true,
  10485760, -- 10 MiB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "site-media: admins list and read"
  on storage.objects for select to authenticated
  using (bucket_id = 'site-media' and (select public.is_admin()));
create policy "site-media: admins upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'site-media' and (select public.is_admin()));
create policy "site-media: admins update"
  on storage.objects for update to authenticated
  using (bucket_id = 'site-media' and (select public.is_admin()))
  with check (bucket_id = 'site-media' and (select public.is_admin()));
create policy "site-media: admins delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'site-media' and (select public.is_admin()));

------------------------------------------------------------------------
-- Default content (the accepted P0/P1 wording). Idempotent. No reviews are
-- seeded: the public site shows none until real ones are approved.
------------------------------------------------------------------------
insert into public.site_settings (
  id, site_name, display_name, location, contact_email,
  seo_default_title, seo_title_template, seo_default_description
) values (
  true, 'Ian Verlinden', 'Ian Verlinden', 'Belgium',
  -- placeholder: replace in /admin/settings
  'hello@ianverlinden.example',
  'Ian Verlinden — Web design & development',
  '%s — Ian Verlinden',
  'I design and develop high-quality websites and web applications that look great, perform well and help businesses grow.'
) on conflict (id) do nothing;

insert into public.site_content (key, content) values
('home', $json$
{
  "hero": {
    "badge": "Available for new projects",
    "headline": { "line1": "Modern websites", "line2": "for", "accent": "ambitious brands." },
    "body": "I design and develop high-quality websites and web applications that look great, perform well and help businesses grow.",
    "primaryCta": { "label": "View my work", "href": "/work" },
    "secondaryCta": { "label": "Start a project", "href": "/contact" },
    "image": { "src": "/media/scenes/hero-workspace.svg", "alt": "A laptop on a warm, lamp-lit desk showing the Red Harbor Studios website." }
  },
  "stats": [
    { "id": "stat-projects", "value": "12+", "label": "Projects completed", "enabled": true },
    { "id": "stat-clients", "value": "8+", "label": "Happy clients", "enabled": true },
    { "id": "stat-experience", "value": "3+", "label": "Years of experience", "enabled": true },
    { "id": "stat-satisfaction", "value": "100%", "label": "Client satisfaction", "enabled": true }
  ],
  "featured": { "eyebrow": "", "heading": "Featured project", "body": "" },
  "services": {
    "eyebrow": "Services",
    "heading": "What I do",
    "statement": "Websites, web applications and everything in between.",
    "body": "From clean landing pages to complex web applications, I focus on modern design, strong performance and a smooth user experience."
  },
  "reviews": { "eyebrow": "Testimonials", "heading": "What clients say", "body": "" },
  "cta": {
    "badge": "Let's work together",
    "heading": "Have a project in mind?",
    "body": "Let's build something great together. I'm always open to new projects and love working with ambitious people.",
    "primaryCta": { "label": "Start a project", "href": "/contact" },
    "secondaryCta": { "label": "View my work", "href": "/work" },
    "image": { "src": "/media/scenes/cta-workspace.svg", "alt": "" }
  }
}
$json$::jsonb),
('about', $json$
{
  "eyebrow": "About me",
  "headline": { "line1": "A passionate developer", "line2": "with a creative", "accent": "mindset." },
  "intro": "I'm Ian, a web developer based in Belgium. I create modern websites and web applications that look great, perform well and help businesses grow.",
  "body": "I enjoy working on challenging projects and bringing ideas to life — from the first sketch and design direction to a fast, maintainable build.",
  "portrait": null,
  "location": "Belgium",
  "availability": "",
  "metrics": [
    { "id": "metric-experience", "value": "3+", "label": "Years of experience", "enabled": true },
    { "id": "metric-projects", "value": "20+", "label": "Projects completed", "enabled": true },
    { "id": "metric-satisfaction", "value": "100%", "label": "Client satisfaction", "enabled": true }
  ]
}
$json$::jsonb),
('contact', $json$
{
  "eyebrow": "Contact",
  "heading": "Start your project",
  "description": "Have an idea or need a new website? Let's talk about it.",
  "email": "",
  "responseTime": "I usually reply within one or two working days.",
  "availability": ""
}
$json$::jsonb)
on conflict (key) do nothing;

insert into public.services (id, slug, title, description, icon, includes, sort_order) values
  ('44444444-4444-4444-8444-444444444401', 'web-design', 'Web Design', 'Modern, clean and conversion-focused designs.', 'design',
   array['Design direction and layout', 'Responsive, mobile-first interfaces', 'Typography and design systems', 'Prototype before build'], 0),
  ('44444444-4444-4444-8444-444444444402', 'web-development', 'Web Development', 'Fast, secure and maintainable websites and web apps.', 'development',
   array['Next.js and TypeScript builds', 'CMS and database integration', 'Performance and SEO foundations', 'Accessible, semantic markup'], 1),
  ('44444444-4444-4444-8444-444444444403', 'redesigns', 'Redesigns', 'Give an existing website a modern upgrade.', 'redesign',
   array['Audit of the current site', 'Fresh visual direction', 'Content and structure clean-up', 'Safe migration with redirects'], 2),
  ('44444444-4444-4444-8444-444444444404', 'maintenance', 'Maintenance', 'Keep websites updated, fast and secure.', 'maintenance',
   array['Dependency and security updates', 'Performance monitoring', 'Content changes on request', 'Backups and uptime checks'], 3)
on conflict (id) do nothing;

insert into public.skills (id, name, sort_order) values
  ('55555555-5555-4555-8555-555555555501', 'Next.js', 0),
  ('55555555-5555-4555-8555-555555555502', 'TypeScript', 1),
  ('55555555-5555-4555-8555-555555555503', 'React', 2),
  ('55555555-5555-4555-8555-555555555504', 'Tailwind CSS', 3),
  ('55555555-5555-4555-8555-555555555505', 'Node.js', 4),
  ('55555555-5555-4555-8555-555555555506', 'PostgreSQL', 5),
  ('55555555-5555-4555-8555-555555555507', 'Supabase', 6)
on conflict (id) do nothing;
