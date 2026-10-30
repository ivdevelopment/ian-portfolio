-- P4: bilingual content (Dutch default, English secondary).
--
-- Purely additive. The existing columns keep holding the ENGLISH copy that is
-- live in production today, so nothing is rewritten or lost. Dutch (and any
-- future language) lives in `translations`, keyed by locale:
--
--   { "nl": { ...same shape as the base content, only fields that differ... } }
--
-- Missing or empty entries fall back to the base text in the application.
-- Existing RLS policies and table grants already cover new columns.

alter table public.site_settings
  add column if not exists translations jsonb not null default '{}'::jsonb
    check (jsonb_typeof(translations) = 'object');

alter table public.site_content
  add column if not exists translations jsonb not null default '{}'::jsonb
    check (jsonb_typeof(translations) = 'object');

alter table public.services
  add column if not exists translations jsonb not null default '{}'::jsonb
    check (jsonb_typeof(translations) = 'object');

alter table public.projects
  add column if not exists translations jsonb not null default '{}'::jsonb
    check (jsonb_typeof(translations) = 'object');

comment on column public.projects.translations is
  'Per-locale overrides, e.g. {"nl": {"subtitle": "...", "shortDescription": "...", "description": "...", "category": "...", "features": ["..."]}}. Base columns are English.';
