-- Mail Assistant tone controls (P10.5.1). Additive: a tone preset and an optional short custom instruction are stored with each recommendation,
-- so a regenerated draft records how it was asked for. Tone is style only: it never changes the action, language, timing or any rule, and the
-- agent functions are unchanged (the tone travels inside the request's own plan and context, written by the CRM server).
alter table public.prospect_mail_recommendations
  add column tone_preset text not null default 'casual' check (tone_preset in ('casual', 'friendly', 'professional', 'direct', 'soft_sales', 'very_short')),
  add column custom_instruction text check (char_length(custom_instruction) <= 200);

-- An admin session may state the tone when queueing a request; it still cannot write a draft.
grant insert (tone_preset, custom_instruction) on public.prospect_mail_recommendations to authenticated;
