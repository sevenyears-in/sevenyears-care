-- Adds the table that stores the Zoho POS connection (Staff → Zoho POS).
-- Run once in Supabase → SQL Editor. Safe to run again.
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
