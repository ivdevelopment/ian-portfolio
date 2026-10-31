-- Prospect CRM: website-sales prospects, their activity history and an import audit trail.
--
-- Private admin data. No public or anonymous access of any kind: RLS is enabled, nothing is granted to
-- `anon`, and every policy requires `is_admin()`.
--
-- Dates: the source tracker only knows calendar days, so first/last contact and follow-ups are `date`
-- columns (a day in Europe/Brussels, no invented time of day). Activities carry `occurred_on` (date, always)
-- and `occurred_at` (timestamptz, only when an exact moment is known).
--
-- Additive only: nothing existing is altered.

create table public.prospects (
  id uuid primary key default gen_random_uuid(),

  company_name text not null check (char_length(btrim(company_name)) between 1 and 200),
  sector text check (char_length(sector) <= 120),
  city text check (char_length(city) <= 120),
  website_url text check (char_length(website_url) <= 500),

  email text check (char_length(email) <= 320),
  contact_name text check (char_length(contact_name) <= 160),
  phone text check (char_length(phone) <= 60),

  status text not null default 'new' check (status in (
    'new', 'researching', 'ready_to_contact', 'contacted', 'follow_up_due', 'replied', 'interested',
    'concept_sent', 'meeting_planned', 'quote_sent', 'won', 'lost', 'not_interested', 'no_response'
  )),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),

  first_contact_on date,
  last_contact_on date,
  next_follow_up_on date,

  estimated_value_eur numeric(12, 2) check (estimated_value_eur >= 0),
  quote_value_eur numeric(12, 2) check (quote_value_eur >= 0),

  -- Whether the outreach is known to have really gone out (kept from the legacy tracker's "Verzending bevestigd?").
  contact_delivery_status text not null default 'unknown'
    check (contact_delivery_status in ('confirmed', 'needs_verification', 'unknown')),

  source text check (char_length(source) <= 160),
  notes text check (char_length(notes) <= 10000),

  linked_project_id uuid references public.projects (id) on delete set null,
  linked_preview_id uuid references public.client_previews (id) on delete set null,

  -- Idempotency key for one-time imports (e.g. "website-prospect-crm:30"): re-running an import never duplicates.
  legacy_ref text unique check (char_length(legacy_ref) <= 120),

  -- Maintained by triggers (list pages must not load the whole timeline).
  last_activity_on date,
  last_activity_title text,

  -- Sort keys, so "Status" and "Priority" sort in pipeline order instead of alphabetically.
  status_order smallint generated always as (
    case status
      when 'new' then 1 when 'researching' then 2 when 'ready_to_contact' then 3 when 'contacted' then 4
      when 'follow_up_due' then 5 when 'replied' then 6 when 'interested' then 7 when 'concept_sent' then 8
      when 'meeting_planned' then 9 when 'quote_sent' then 10 when 'won' then 11 when 'lost' then 12
      when 'not_interested' then 13 when 'no_response' then 14 else 99 end
  ) stored,
  priority_order smallint generated always as (
    case priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 when 'low' then 4 else 99 end
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Practical indexes only (the filters and sorts the list page really uses).
create index prospects_status_idx on public.prospects (status);
create index prospects_priority_idx on public.prospects (priority);
create index prospects_next_follow_up_idx on public.prospects (next_follow_up_on);
create index prospects_created_at_idx on public.prospects (created_at desc);
create index prospects_company_name_idx on public.prospects (lower(company_name));
create index prospects_linked_project_idx on public.prospects (linked_project_id) where linked_project_id is not null;
create index prospects_linked_preview_idx on public.prospects (linked_preview_id) where linked_preview_id is not null;

create trigger prospects_set_updated_at before update on public.prospects
  for each row execute function public.set_updated_at();

create table public.prospect_activities (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  type text not null check (type in (
    'created', 'imported', 'note', 'status_changed', 'contacted', 'follow_up_sent', 'reply_received',
    'concept_sent', 'meeting_planned', 'quote_sent', 'follow_up_set', 'follow_up_done',
    'preview_linked', 'preview_unlinked', 'project_linked', 'project_created', 'won', 'lost', 'other'
  )),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  occurred_on date not null default ((now() at time zone 'Europe/Brussels')::date),
  occurred_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index prospect_activities_timeline_idx on public.prospect_activities (prospect_id, occurred_on desc, created_at desc);

-- Audit trail of imports and migrations: nothing is dropped silently.
create table public.prospect_imports (
  id uuid primary key default gen_random_uuid(),
  source text not null check (char_length(source) <= 200),
  file_name text check (char_length(file_name) <= 300),
  rows_parsed integer not null check (rows_parsed >= 0),
  rows_imported integer not null check (rows_imported >= 0),
  rows_skipped integer not null check (rows_skipped >= 0),
  duplicates integer not null default 0 check (duplicates >= 0),
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

------------------------------------------------------------------------
-- Triggers: history that cannot be forgotten by the application
------------------------------------------------------------------------

-- A new prospect and every status change leave an activity behind.
create function public.prospects_log_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- One-time migrations (legacy_ref set) bring their own history and are recorded in prospect_imports,
    -- so no "created today" event is invented for them.
    if new.legacy_ref is null then
      insert into public.prospect_activities (prospect_id, type, title) values (new.id, 'created', 'Prospect created');
    end if;
  elsif new.status is distinct from old.status then
    insert into public.prospect_activities (prospect_id, type, title, metadata)
    values (new.id, 'status_changed', 'Status changed', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return null;
end;
$$;
create trigger prospects_log_activity_ins after insert on public.prospects
  for each row execute function public.prospects_log_activity();
create trigger prospects_log_activity_upd after update of status on public.prospects
  for each row execute function public.prospects_log_activity();

-- Keeps the list-page summary of the latest activity current.
create function public.prospect_activities_sync_last()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pid uuid := coalesce(new.prospect_id, old.prospect_id);
begin
  update public.prospects p
     set last_activity_on = l.occurred_on, last_activity_title = l.title
    from (
      select a.occurred_on, a.title
        from public.prospect_activities a
       where a.prospect_id = pid
       order by a.occurred_on desc, a.created_at desc
       limit 1
    ) l
   where p.id = pid;
  return null;
end;
$$;
create trigger prospect_activities_sync_last_ins after insert on public.prospect_activities
  for each row execute function public.prospect_activities_sync_last();
create trigger prospect_activities_sync_last_del after delete on public.prospect_activities
  for each row execute function public.prospect_activities_sync_last();

------------------------------------------------------------------------
-- Privileges + RLS: admins only. `anon` gets nothing at all.
------------------------------------------------------------------------
alter table public.prospects enable row level security;
alter table public.prospect_activities enable row level security;
alter table public.prospect_imports enable row level security;

revoke all on public.prospects, public.prospect_activities, public.prospect_imports from anon, authenticated;
grant select, insert, update, delete on public.prospects to authenticated;
-- History is append-only (plus removal with its prospect); imports are a log.
grant select, insert, delete on public.prospect_activities to authenticated;
grant select, insert on public.prospect_imports to authenticated;

create policy "prospects: admins full access" on public.prospects
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "prospect_activities: admins read" on public.prospect_activities
  for select to authenticated using ((select public.is_admin()));
create policy "prospect_activities: admins insert" on public.prospect_activities
  for insert to authenticated with check ((select public.is_admin()));
create policy "prospect_activities: admins delete" on public.prospect_activities
  for delete to authenticated using ((select public.is_admin()));
create policy "prospect_imports: admins read" on public.prospect_imports
  for select to authenticated using ((select public.is_admin()));
create policy "prospect_imports: admins insert" on public.prospect_imports
  for insert to authenticated with check ((select public.is_admin()));

------------------------------------------------------------------------
-- Dashboard / list summary (RLS applies: callers that are not admins see nothing)
--
--  "open"         = not won / lost / not interested / no response
--  "replies"      = the prospect responded at some point (replied, interested, concept sent, meeting, quote, won)
--  "opportunities"= open prospects that responded
--  pipeline_value = estimated value of OPEN prospects that HAVE one (a blank value is not a zero-value deal)
------------------------------------------------------------------------
create function public.prospect_summary(p_today date, p_week_end date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'total', count(*),
    'contacted', count(*) filter (where status not in ('new', 'researching', 'ready_to_contact')),
    'replies', count(*) filter (where status in ('replied', 'interested', 'concept_sent', 'meeting_planned', 'quote_sent', 'won')),
    'active_opportunities', count(*) filter (where status in ('replied', 'interested', 'concept_sent', 'meeting_planned', 'quote_sent')),
    'followups_overdue', count(*) filter (where status not in ('won', 'lost', 'not_interested', 'no_response') and next_follow_up_on < p_today),
    'followups_today', count(*) filter (where status not in ('won', 'lost', 'not_interested', 'no_response') and next_follow_up_on = p_today),
    'followups_week', count(*) filter (where status not in ('won', 'lost', 'not_interested', 'no_response') and next_follow_up_on > p_today and next_follow_up_on <= p_week_end),
    'pipeline_value', coalesce(sum(estimated_value_eur) filter (where status not in ('won', 'lost', 'not_interested', 'no_response')), 0),
    'pipeline_count', count(*) filter (where status not in ('won', 'lost', 'not_interested', 'no_response') and estimated_value_eur is not null),
    'quote_total', coalesce(sum(quote_value_eur) filter (where status not in ('lost', 'not_interested', 'no_response')), 0),
    'quote_count', count(*) filter (where status not in ('lost', 'not_interested', 'no_response') and quote_value_eur is not null),
    'won_value', coalesce(sum(quote_value_eur) filter (where status = 'won'), 0),
    'won_count', count(*) filter (where status = 'won')
  )
  from public.prospects;
$$;
revoke all on function public.prospect_summary(date, date) from public, anon;
grant execute on function public.prospect_summary(date, date) to authenticated;
