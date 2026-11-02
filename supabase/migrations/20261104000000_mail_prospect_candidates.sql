-- Prospect candidates found by the manual Zoho sync (additive; nothing existing is altered).
--
-- An outgoing message to an external address that matches no prospect is NOT a prospect. The sync records it here
-- as a candidate so a person can review it: "Add as prospect" or "Ignore". One row per recipient address, so a repeated
-- sync never duplicates it and an ignored address never comes back.
--
-- Privacy: the same metadata the CRM already keeps for matched mail (addresses, subject, timestamps) plus a short snippet
-- while a candidate is pending. Deciding it is auditable and reversible later: 'added' hands the messages to mail_messages;
-- 'ignored' keeps the address, the provider message ids and their metadata (never the snippet, never a body) and when and why
-- it was ignored, so it can be explained and, if ever wanted, restored to 'pending'. Nothing is deleted from Zoho.
-- Admin-only, RLS, no grants for `anon`.

create table public.mail_prospect_candidates (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.mail_connections (id) on delete cascade,
  -- The recipient, lower case.
  address text not null check (char_length(address) <= 320 and address = lower(address)),
  -- The recipient's display name from the message header, when there was one.
  display_name text check (char_length(display_name) <= 200),
  status text not null default 'pending' check (status in ('pending', 'ignored', 'added')),
  subject text check (char_length(subject) <= 998),
  first_message_at timestamptz not null,
  last_message_at timestamptz not null,
  message_count integer not null default 1 check (message_count >= 0),
  -- The outgoing messages seen for this address (same shape as mail_messages rows, at most 20). Emptied when 'added' (they live in
  -- mail_messages then); kept without snippets when 'ignored', so the decision stays explainable and reversible.
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) <= 20),
  prospect_id uuid references public.prospects (id) on delete set null,
  -- Set when status = 'ignored'. Together with decided_by and decision_note this is the audit trail of the decision.
  ignored_at timestamptz,
  decision_note text check (char_length(decision_note) <= 300),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, address),
  check (status <> 'ignored' or ignored_at is not null)
);
create index mail_prospect_candidates_status_idx on public.mail_prospect_candidates (connection_id, status, last_message_at desc);

create trigger mail_prospect_candidates_set_updated_at before update on public.mail_prospect_candidates
  for each row execute function public.set_updated_at();

alter table public.mail_prospect_candidates enable row level security;
revoke all on public.mail_prospect_candidates from anon, authenticated;
grant select, insert, update on public.mail_prospect_candidates to authenticated;
create policy "mail_prospect_candidates: admins only" on public.mail_prospect_candidates
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
