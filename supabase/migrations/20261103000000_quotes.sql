-- Quotes / offertes: a quote, its line items, an audit trail, reusable service templates and settings.
--
-- Private admin data. RLS is enabled everywhere, nothing is granted to `anon`, every policy requires `is_admin()`.
--
-- Money: `numeric` only (never floats). All amounts are whole cents (2 decimals). The arithmetic lives in ONE place,
-- src/lib/quotes/money.ts (half-up rounding to the cent at every stage); the database does not recompute, it enforces the
-- identities between the stored figures (see the CHECK constraints) so a bug elsewhere cannot persist inconsistent totals.
--
-- Snapshots: a quote copies the client's details and every line's text/price at the time it is written. Editing or deleting
-- a prospect, a project or a service template never changes an existing quote. Deleting a prospect keeps its quotes
-- (the link is set to NULL; the snapshot stays).
--
-- Additive only: nothing existing is altered.

------------------------------------------------------------------------
-- Numbering: Q-YYYY-NNNN, one counter row per year, allocated under a row lock inside the creating transaction
-- (so concurrent creations serialize, a rolled-back creation gives its number back, and a new year restarts at 0001).
------------------------------------------------------------------------
create table public.quote_counters (
  year integer primary key check (year between 2000 and 9999),
  last_number integer not null check (last_number >= 0)
);

create function public.allocate_quote_number(p_year integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not (select public.is_admin()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.quote_counters (year, last_number) values (p_year, 1)
  on conflict (year) do update set last_number = public.quote_counters.last_number + 1
  returning last_number into n;
  return format('Q-%s-%s', p_year, lpad(n::text, 4, '0'));
end;
$$;
revoke all on function public.allocate_quote_number(integer) from public, anon;
grant execute on function public.allocate_quote_number(integer) to authenticated;

------------------------------------------------------------------------
-- Settings (one row) and reusable service templates
------------------------------------------------------------------------
create table public.quote_settings (
  id boolean primary key default true check (id),
  default_language text not null default 'nl' check (default_language in ('nl', 'en')),
  default_tax_rate numeric(5, 2) not null default 21 check (default_tax_rate between 0 and 100),
  default_validity_days integer not null default 14 check (default_validity_days between 1 and 365),
  default_intro text check (char_length(default_intro) <= 5000),
  default_terms text check (char_length(default_terms) <= 10000),
  business_name text not null default 'Ian Verlinden' check (char_length(btrim(business_name)) between 1 and 160),
  business_tagline text check (char_length(business_tagline) <= 160),
  business_email text check (char_length(business_email) <= 320),
  business_website text check (char_length(business_website) <= 300),
  -- Ready for the day an invoice module (or the PDF footer) needs them. Deliberately empty: nothing is invented.
  business_phone text check (char_length(business_phone) <= 60),
  business_address text check (char_length(business_address) <= 500),
  business_vat_number text check (char_length(business_vat_number) <= 40),
  business_iban text check (char_length(business_iban) <= 40),
  updated_at timestamptz not null default now()
);
insert into public.quote_settings (business_tagline, business_email, business_website)
values ('Web Design & Development', 'hello@ianverlinden.com', 'ianverlinden.com');
create trigger quote_settings_set_updated_at before update on public.quote_settings
  for each row execute function public.set_updated_at();

create table public.quote_item_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text check (char_length(description) <= 5000),
  default_unit text check (char_length(default_unit) <= 30),
  -- NULL = "price me per quote": no price is invented for the seeded examples.
  default_unit_price numeric(12, 2) check (default_unit_price >= 0),
  default_tax_rate numeric(5, 2) not null default 21 check (default_tax_rate between 0 and 100),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quote_item_templates_active_idx on public.quote_item_templates (active, sort_order, name);
create trigger quote_item_templates_set_updated_at before update on public.quote_item_templates
  for each row execute function public.set_updated_at();

insert into public.quote_item_templates (name, default_unit, sort_order) values
  ('Website design', 'stuk', 10),
  ('Website development', 'stuk', 20),
  ('Responsive implementation', 'stuk', 30),
  ('CMS integration', 'stuk', 40),
  ('SEO setup', 'stuk', 50),
  ('Hosting setup', 'stuk', 60),
  ('Maintenance', 'maand', 70),
  ('E-commerce functionality', 'stuk', 80),
  ('Additional page', 'stuk', 90),
  ('Custom web application', 'stuk', 100);

------------------------------------------------------------------------
-- Quotes
------------------------------------------------------------------------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique check (quote_number ~ '^Q-[0-9]{4}-[0-9]{4,}$'),

  -- Relationships are optional and never cascade: deleting a prospect/project keeps the quote.
  prospect_id uuid references public.prospects (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,

  status text not null default 'draft' check (status in ('draft', 'ready', 'sent', 'accepted', 'rejected', 'expired', 'cancelled')),
  -- Optional reason belonging to the latest status change (rejection / cancellation note).
  status_note text check (char_length(status_note) <= 2000),
  language text not null default 'nl' check (language in ('nl', 'en')),

  -- Client snapshot (a draft may be incomplete; Ready/Sent require the essentials, see quotes_guard).
  client_name text check (char_length(client_name) <= 200),
  client_company text check (char_length(client_company) <= 200),
  client_email text check (char_length(client_email) <= 320),
  client_address text check (char_length(client_address) <= 1000),

  title text check (char_length(title) <= 200),
  intro text check (char_length(intro) <= 5000),
  notes text check (char_length(notes) <= 5000),
  terms text check (char_length(terms) <= 10000),

  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  -- Optional quote-level discount on top of the per-line discounts; applied to the subtotal and spread over the lines.
  discount_type text not null default 'none' check (discount_type in ('none', 'percent', 'fixed')),
  discount_value numeric(12, 2) not null default 0 check (discount_value >= 0),

  -- subtotal = sum of line_subtotal (after line discounts, excl. VAT); discount_total = the quote-level discount;
  -- tax_total = sum of line_tax; total = subtotal - discount_total + tax_total.
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),
  discount_total numeric(14, 2) not null default 0 check (discount_total >= 0),
  tax_total numeric(14, 2) not null default 0 check (tax_total >= 0),
  total numeric(14, 2) not null default 0 check (total >= 0),

  valid_until date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,

  constraint quotes_discount_kind check (
    (discount_type = 'none' and discount_value = 0) or
    (discount_type = 'percent' and discount_value <= 100) or
    discount_type = 'fixed'
  ),
  constraint quotes_discount_within_subtotal check (discount_total <= subtotal),
  constraint quotes_total_identity check (total = subtotal - discount_total + tax_total)
);
create index quotes_prospect_idx on public.quotes (prospect_id) where prospect_id is not null;
create index quotes_project_idx on public.quotes (project_id) where project_id is not null;
create index quotes_status_idx on public.quotes (status);
create index quotes_created_at_idx on public.quotes (created_at desc);
create index quotes_valid_until_idx on public.quotes (valid_until);
create trigger quotes_set_updated_at before update on public.quotes
  for each row execute function public.set_updated_at();

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  position integer not null check (position >= 0),
  -- Provenance only: the line below is a snapshot, a template that changes or disappears never alters it.
  template_id uuid references public.quote_item_templates (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  quantity numeric(12, 3) not null check (quantity >= 0),
  unit text check (char_length(unit) <= 30),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  discount_percent numeric(5, 2) not null default 0 check (discount_percent between 0 and 100),
  tax_rate numeric(5, 2) not null default 21 check (tax_rate between 0 and 100),
  -- line_subtotal: quantity x price less the line discount (excl. VAT). quote_discount_share: this line's part of the
  -- quote-level discount. line_tax: VAT on (line_subtotal - share). line_total: incl. VAT.
  line_subtotal numeric(14, 2) not null check (line_subtotal >= 0),
  quote_discount_share numeric(14, 2) not null default 0 check (quote_discount_share >= 0),
  line_tax numeric(14, 2) not null check (line_tax >= 0),
  line_total numeric(14, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  constraint quote_items_share_within_line check (quote_discount_share <= line_subtotal),
  constraint quote_items_total_identity check (line_total = line_subtotal - quote_discount_share + line_tax)
);
create index quote_items_quote_idx on public.quote_items (quote_id, position);

create table public.quote_activities (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  type text not null check (type in (
    'created', 'edited', 'ready', 'sent', 'accepted', 'rejected', 'cancelled', 'expired', 'reopened',
    'validity_extended', 'pdf_generated', 'duplicated', 'project_linked', 'other'
  )),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index quote_activities_timeline_idx on public.quote_activities (quote_id, created_at desc);

------------------------------------------------------------------------
-- Guard: allowed status transitions, locked content once a quote has left the editable states, timestamps.
-- Applies to everyone (it is the one rule that the application cannot forget).
--
--   draft     -> ready, cancelled
--   ready     -> draft, sent, cancelled
--   sent      -> accepted, rejected, expired, cancelled
--   expired   -> sent (validity extended), accepted, rejected, cancelled
--   accepted  -> cancelled
--   rejected  -> cancelled
--   cancelled -> (final)
------------------------------------------------------------------------
create function public.quotes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not exists (
      select 1
        from (values
          ('draft', 'ready'), ('draft', 'cancelled'),
          ('ready', 'draft'), ('ready', 'sent'), ('ready', 'cancelled'),
          ('sent', 'accepted'), ('sent', 'rejected'), ('sent', 'expired'), ('sent', 'cancelled'),
          ('expired', 'sent'), ('expired', 'accepted'), ('expired', 'rejected'), ('expired', 'cancelled'),
          ('accepted', 'cancelled'),
          ('rejected', 'cancelled')
        ) as t (a, b)
       where t.a = old.status and t.b = new.status
    ) then
      raise exception 'A quote cannot go from % to %.', old.status, new.status using errcode = 'check_violation';
    end if;

    if new.status in ('ready', 'sent') and old.status in ('draft', 'ready') then
      if btrim(coalesce(new.client_name, '')) = '' or btrim(coalesce(new.title, '')) = '' then
        raise exception 'A client name and a title are required before a quote can be %.', new.status using errcode = 'check_violation';
      end if;
      if not exists (select 1 from public.quote_items where quote_id = new.id) then
        raise exception 'Add at least one line item before a quote can be %.', new.status using errcode = 'check_violation';
      end if;
    end if;

    if new.status = 'sent' then new.sent_at := coalesce(old.sent_at, now()); end if;
    if new.status = 'accepted' then new.accepted_at := now(); end if;
    if new.status = 'rejected' then new.rejected_at := now(); end if;
  end if;

  -- Content is only editable while the quote is a draft or ready. Afterwards only the validity (sent/expired),
  -- the status fields and the prospect/project links may change.
  if old.status not in ('draft', 'ready') and (
    (new.quote_number, new.language, new.client_name, new.client_company, new.client_email, new.client_address,
     new.title, new.intro, new.notes, new.terms, new.currency, new.discount_type, new.discount_value,
     new.subtotal, new.discount_total, new.tax_total, new.total)
    is distinct from
    (old.quote_number, old.language, old.client_name, old.client_company, old.client_email, old.client_address,
     old.title, old.intro, old.notes, old.terms, old.currency, old.discount_type, old.discount_value,
     old.subtotal, old.discount_total, old.tax_total, old.total)
  ) then
    raise exception 'Quote % is % and can no longer be edited. Duplicate it to make a revision.', old.quote_number, old.status using errcode = 'check_violation';
  end if;
  if old.status not in ('draft', 'ready', 'sent', 'expired') and new.valid_until is distinct from old.valid_until then
    raise exception 'Quote % is % and its validity can no longer be changed.', old.quote_number, old.status using errcode = 'check_violation';
  end if;
  if new.quote_number is distinct from old.quote_number then
    raise exception 'A quote number never changes.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
create trigger quotes_guard before update on public.quotes
  for each row execute function public.quotes_guard();

-- History that the application cannot forget: creation, every status change, validity and project changes.
create function public.quotes_log_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  kind text;
  heading text;
begin
  if tg_op = 'INSERT' then
    insert into public.quote_activities (quote_id, type, title, metadata)
    values (new.id, 'created', 'Quote created', jsonb_build_object('quote_number', new.quote_number));
    return null;
  end if;

  if new.status is distinct from old.status then
    kind := case when new.status = 'draft' or old.status = 'expired' then 'reopened' else new.status end;
    heading := case
      when new.status = 'draft' then 'Moved back to draft'
      when old.status = 'expired' and new.status = 'sent' then 'Reopened as sent'
      when new.status = 'ready' then 'Marked ready to send'
      when new.status = 'sent' then 'Marked as sent'
      when new.status = 'accepted' then 'Marked as accepted'
      when new.status = 'rejected' then 'Marked as rejected'
      when new.status = 'expired' then 'Marked as expired'
      else 'Cancelled'
    end;
    insert into public.quote_activities (quote_id, type, title, description, metadata)
    values (new.id, kind, heading, new.status_note, jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.valid_until is distinct from old.valid_until and old.status in ('sent', 'expired') then
    insert into public.quote_activities (quote_id, type, title, metadata)
    values (new.id, 'validity_extended', 'Validity changed', jsonb_build_object('from', old.valid_until, 'to', new.valid_until));
  end if;

  if new.project_id is distinct from old.project_id and new.project_id is not null then
    insert into public.quote_activities (quote_id, type, title, metadata)
    values (new.id, 'project_linked', 'Linked to a project', jsonb_build_object('project_id', new.project_id));
  end if;
  return null;
end;
$$;
create trigger quotes_log_activity_ins after insert on public.quotes
  for each row execute function public.quotes_log_activity();
create trigger quotes_log_activity_upd after update on public.quotes
  for each row execute function public.quotes_log_activity();

------------------------------------------------------------------------
-- Writes go through these functions so a quote and its lines are always saved in ONE transaction.
-- SECURITY INVOKER: Row Level Security still applies, a non-admin can do nothing.
-- The application sends already-calculated figures; the identities are re-checked here.
------------------------------------------------------------------------
create function public.quotes_assert_consistent(p_quote_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  q public.quotes;
  sums record;
begin
  select * into q from public.quotes where id = p_quote_id;
  select coalesce(sum(line_subtotal), 0) as subtotal,
         coalesce(sum(quote_discount_share), 0) as discount,
         coalesce(sum(line_tax), 0) as tax,
         count(*) as n
    into sums
    from public.quote_items where quote_id = p_quote_id;
  if q.subtotal <> sums.subtotal or q.discount_total <> sums.discount or q.tax_total <> sums.tax then
    raise exception 'The quote totals do not match its lines.' using errcode = 'check_violation';
  end if;
  if q.status in ('ready', 'sent') and sums.n = 0 then
    raise exception 'A quote that is ready needs at least one line item.' using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function public.quotes_assert_consistent(uuid) from public, anon;
grant execute on function public.quotes_assert_consistent(uuid) to authenticated;

create function public.quotes_write_items(p_quote_id uuid, p_items jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.quote_items where quote_id = p_quote_id;
  insert into public.quote_items (
    quote_id, position, template_id, title, description, quantity, unit, unit_price, discount_percent, tax_rate,
    line_subtotal, quote_discount_share, line_tax, line_total
  )
  select p_quote_id, (e.ord - 1)::integer, nullif(e.item ->> 'template_id', '')::uuid, e.item ->> 'title',
         nullif(e.item ->> 'description', ''), (e.item ->> 'quantity')::numeric, nullif(e.item ->> 'unit', ''),
         (e.item ->> 'unit_price')::numeric, (e.item ->> 'discount_percent')::numeric, (e.item ->> 'tax_rate')::numeric,
         (e.item ->> 'line_subtotal')::numeric, (e.item ->> 'quote_discount_share')::numeric,
         (e.item ->> 'line_tax')::numeric, (e.item ->> 'line_total')::numeric
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e (item, ord);
end;
$$;
revoke all on function public.quotes_write_items(uuid, jsonb) from public, anon;
grant execute on function public.quotes_write_items(uuid, jsonb) to authenticated;

create function public.create_quote(p_quote jsonb, p_items jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_id uuid;
  number text;
begin
  number := public.allocate_quote_number(extract(year from (now() at time zone 'Europe/Brussels'))::integer);
  insert into public.quotes (
    quote_number, prospect_id, project_id, language, client_name, client_company, client_email, client_address,
    title, intro, notes, terms, currency, discount_type, discount_value, subtotal, discount_total, tax_total, total, valid_until
  ) values (
    number, nullif(p_quote ->> 'prospect_id', '')::uuid, nullif(p_quote ->> 'project_id', '')::uuid,
    coalesce(p_quote ->> 'language', 'nl'), nullif(p_quote ->> 'client_name', ''), nullif(p_quote ->> 'client_company', ''),
    nullif(p_quote ->> 'client_email', ''), nullif(p_quote ->> 'client_address', ''), nullif(p_quote ->> 'title', ''),
    nullif(p_quote ->> 'intro', ''), nullif(p_quote ->> 'notes', ''), nullif(p_quote ->> 'terms', ''),
    coalesce(p_quote ->> 'currency', 'EUR'), coalesce(p_quote ->> 'discount_type', 'none'),
    coalesce((p_quote ->> 'discount_value')::numeric, 0), (p_quote ->> 'subtotal')::numeric,
    (p_quote ->> 'discount_total')::numeric, (p_quote ->> 'tax_total')::numeric, (p_quote ->> 'total')::numeric,
    nullif(p_quote ->> 'valid_until', '')::date
  ) returning id into new_id;
  perform public.quotes_write_items(new_id, p_items);
  perform public.quotes_assert_consistent(new_id);
  return new_id;
end;
$$;
revoke all on function public.create_quote(jsonb, jsonb) from public, anon;
grant execute on function public.create_quote(jsonb, jsonb) to authenticated;

-- Replaces the quote's content and lines. `p_expected_updated_at` guards against two tabs overwriting each other.
create function public.update_quote(p_id uuid, p_quote jsonb, p_items jsonb, p_expected_updated_at timestamptz)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  current_row public.quotes;
  stamp timestamptz;
begin
  select * into current_row from public.quotes where id = p_id for update;
  if not found then
    raise exception 'Quote not found.' using errcode = 'no_data_found';
  end if;
  if p_expected_updated_at is not null and current_row.updated_at <> p_expected_updated_at then
    raise exception 'This quote was changed elsewhere. Reload it before saving.';
  end if;
  if current_row.status not in ('draft', 'ready') then
    raise exception 'Quote % is % and can no longer be edited. Duplicate it to make a revision.', current_row.quote_number, current_row.status using errcode = 'check_violation';
  end if;

  -- Lines first: the totals are checked against them, and the items policy needs the quote to still be editable.
  perform public.quotes_write_items(p_id, p_items);
  update public.quotes set
    prospect_id = nullif(p_quote ->> 'prospect_id', '')::uuid,
    language = coalesce(p_quote ->> 'language', 'nl'),
    client_name = nullif(p_quote ->> 'client_name', ''),
    client_company = nullif(p_quote ->> 'client_company', ''),
    client_email = nullif(p_quote ->> 'client_email', ''),
    client_address = nullif(p_quote ->> 'client_address', ''),
    title = nullif(p_quote ->> 'title', ''),
    intro = nullif(p_quote ->> 'intro', ''),
    notes = nullif(p_quote ->> 'notes', ''),
    terms = nullif(p_quote ->> 'terms', ''),
    currency = coalesce(p_quote ->> 'currency', 'EUR'),
    discount_type = coalesce(p_quote ->> 'discount_type', 'none'),
    discount_value = coalesce((p_quote ->> 'discount_value')::numeric, 0),
    subtotal = (p_quote ->> 'subtotal')::numeric,
    discount_total = (p_quote ->> 'discount_total')::numeric,
    tax_total = (p_quote ->> 'tax_total')::numeric,
    total = (p_quote ->> 'total')::numeric,
    valid_until = nullif(p_quote ->> 'valid_until', '')::date
   where id = p_id
   returning updated_at into stamp;
  perform public.quotes_assert_consistent(p_id);
  if current_row.status = 'ready' and exists (
    select 1 from public.quotes where id = p_id and (btrim(coalesce(client_name, '')) = '' or btrim(coalesce(title, '')) = '')
  ) then
    raise exception 'A client name and a title are required while a quote is ready.' using errcode = 'check_violation';
  end if;

  -- One "edited" entry per editing session, not one per save.
  if not exists (
    select 1 from public.quote_activities where quote_id = p_id and type = 'edited' and created_at > now() - interval '15 minutes'
  ) then
    insert into public.quote_activities (quote_id, type, title) values (p_id, 'edited', 'Quote edited');
  end if;
  return stamp;
end;
$$;
revoke all on function public.update_quote(uuid, jsonb, jsonb, timestamptz) from public, anon;
grant execute on function public.update_quote(uuid, jsonb, jsonb, timestamptz) to authenticated;

-- A copy as a fresh draft: new number, same content and lines, no sent/accepted/rejected history, validity restarted.
create function public.duplicate_quote(p_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  src public.quotes;
  new_id uuid;
  validity integer;
begin
  select * into src from public.quotes where id = p_id;
  if not found then
    raise exception 'Quote not found.' using errcode = 'no_data_found';
  end if;
  select default_validity_days into validity from public.quote_settings limit 1;
  insert into public.quotes (
    quote_number, prospect_id, language, client_name, client_company, client_email, client_address, title, intro, notes, terms,
    currency, discount_type, discount_value, subtotal, discount_total, tax_total, total, valid_until
  ) values (
    public.allocate_quote_number(extract(year from (now() at time zone 'Europe/Brussels'))::integer),
    src.prospect_id, src.language, src.client_name, src.client_company, src.client_email, src.client_address, src.title,
    src.intro, src.notes, src.terms, src.currency, src.discount_type, src.discount_value, src.subtotal, src.discount_total,
    src.tax_total, src.total, (now() at time zone 'Europe/Brussels')::date + coalesce(validity, 14)
  ) returning id into new_id;
  insert into public.quote_items (
    quote_id, position, template_id, title, description, quantity, unit, unit_price, discount_percent, tax_rate,
    line_subtotal, quote_discount_share, line_tax, line_total
  )
  select new_id, position, template_id, title, description, quantity, unit, unit_price, discount_percent, tax_rate,
         line_subtotal, quote_discount_share, line_tax, line_total
    from public.quote_items where quote_id = p_id;
  insert into public.quote_activities (quote_id, type, title, metadata)
  values (new_id, 'duplicated', 'Duplicated from ' || src.quote_number, jsonb_build_object('from_quote_id', src.id, 'from_number', src.quote_number));
  return new_id;
end;
$$;
revoke all on function public.duplicate_quote(uuid) from public, anon;
grant execute on function public.duplicate_quote(uuid) to authenticated;

------------------------------------------------------------------------
-- Privileges + RLS: admins only. `anon` gets nothing at all.
------------------------------------------------------------------------
alter table public.quote_counters enable row level security;
alter table public.quote_settings enable row level security;
alter table public.quote_item_templates enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_activities enable row level security;

revoke all on public.quote_counters, public.quote_settings, public.quote_item_templates, public.quotes, public.quote_items, public.quote_activities from anon, authenticated;
-- quote_counters: no grants and no policies; only allocate_quote_number (security definer) touches it.
grant select, update on public.quote_settings to authenticated;
grant select, insert, update, delete on public.quote_item_templates to authenticated;
grant select, insert, update, delete on public.quotes to authenticated;
grant select, insert, update, delete on public.quote_items to authenticated;
-- History is append-only (it disappears only together with a draft that is deleted).
grant select, insert on public.quote_activities to authenticated;

create policy "quote_settings: admins read" on public.quote_settings
  for select to authenticated using ((select public.is_admin()));
create policy "quote_settings: admins update" on public.quote_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "quote_item_templates: admins full access" on public.quote_item_templates
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "quotes: admins read" on public.quotes
  for select to authenticated using ((select public.is_admin()));
create policy "quotes: admins insert" on public.quotes
  for insert to authenticated with check ((select public.is_admin()));
create policy "quotes: admins update" on public.quotes
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
-- Only drafts can be deleted. Sent / accepted / rejected / cancelled quotes are kept as the record.
create policy "quotes: admins delete drafts" on public.quotes
  for delete to authenticated using ((select public.is_admin()) and status = 'draft');

create policy "quote_items: admins read" on public.quote_items
  for select to authenticated using ((select public.is_admin()));
create policy "quote_items: admins insert while editable" on public.quote_items
  for insert to authenticated with check (
    (select public.is_admin()) and exists (select 1 from public.quotes q where q.id = quote_id and q.status in ('draft', 'ready'))
  );
create policy "quote_items: admins update while editable" on public.quote_items
  for update to authenticated
  using ((select public.is_admin()) and exists (select 1 from public.quotes q where q.id = quote_id and q.status in ('draft', 'ready')))
  with check ((select public.is_admin()) and exists (select 1 from public.quotes q where q.id = quote_id and q.status in ('draft', 'ready')));
create policy "quote_items: admins delete while editable" on public.quote_items
  for delete to authenticated
  using ((select public.is_admin()) and exists (select 1 from public.quotes q where q.id = quote_id and q.status in ('draft', 'ready')));

create policy "quote_activities: admins read" on public.quote_activities
  for select to authenticated using ((select public.is_admin()));
create policy "quote_activities: admins insert" on public.quote_activities
  for insert to authenticated with check ((select public.is_admin()));
