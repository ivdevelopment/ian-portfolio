-- Zoho Mail integration foundation (read-only sync groundwork). Additive and inert: nothing writes here until the
-- integration is enabled (ZOHO_MAIL_ENABLED=1) AND an admin connects the mailbox.
--
-- Privacy: mail metadata only (addresses, subject, a short snippet, timestamps). No bodies, attachments or full
-- mailbox copies; only messages whose participants match a prospect's email are stored. Admin-only, RLS on every
-- table, `anon` has no grants.
--
-- The OAuth refresh token is stored ENCRYPTED (AES-256-GCM, key held only in the server environment), so a database
-- leak or an API read of this table reveals nothing usable.

create table public.mail_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'zoho' check (provider in ('zoho')),
  account_email text not null check (char_length(account_email) <= 320),
  provider_account_id text not null check (char_length(provider_account_id) <= 100),
  data_center text not null check (data_center in ('eu', 'com', 'in', 'com.au', 'jp')),
  scopes text not null check (char_length(scopes) <= 500),
  refresh_token_encrypted text not null,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  -- Incremental sync position: only the day to search from (never message content).
  sync_from date,
  updated_at timestamptz not null default now(),
  unique (provider, account_email)
);

create table public.mail_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.mail_connections (id) on delete cascade,
  mode text not null check (mode in ('dry_run', 'sync')),
  window_from date,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  messages_checked integer not null default 0,
  messages_matched integer not null default 0,
  messages_stored integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  -- Dry runs keep a small sample of what WOULD match (subject + prospect), so it can be reviewed before syncing.
  preview jsonb not null default '[]'::jsonb
);
create index mail_sync_runs_connection_idx on public.mail_sync_runs (connection_id, started_at desc);

create table public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.mail_connections (id) on delete cascade,
  provider_message_id text not null check (char_length(provider_message_id) <= 100),
  provider_thread_id text check (char_length(provider_thread_id) <= 100),
  folder_id text check (char_length(folder_id) <= 100),
  direction text not null check (direction in ('incoming', 'outgoing')),
  from_address text not null check (char_length(from_address) <= 320),
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  subject text check (char_length(subject) <= 998),
  -- Plain text only, short. HTML is never stored or rendered.
  snippet text check (char_length(snippet) <= 500),
  sent_at timestamptz not null,
  prospect_id uuid references public.prospects (id) on delete cascade,
  synced_at timestamptz not null default now(),
  -- Re-running a sync can never duplicate a message.
  unique (connection_id, provider_message_id)
);
create index mail_messages_prospect_idx on public.mail_messages (prospect_id, sent_at desc) where prospect_id is not null;
create index mail_messages_thread_idx on public.mail_messages (connection_id, provider_thread_id);

create trigger mail_connections_set_updated_at before update on public.mail_connections
  for each row execute function public.set_updated_at();

alter table public.mail_connections enable row level security;
alter table public.mail_sync_runs enable row level security;
alter table public.mail_messages enable row level security;

revoke all on public.mail_connections, public.mail_sync_runs, public.mail_messages from anon, authenticated;
grant select, insert, update, delete on public.mail_connections to authenticated;
grant select, insert, update on public.mail_sync_runs to authenticated;
grant select, insert, update, delete on public.mail_messages to authenticated;

create policy "mail_connections: admins only" on public.mail_connections
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "mail_sync_runs: admins only" on public.mail_sync_runs
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "mail_messages: admins only" on public.mail_messages
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
