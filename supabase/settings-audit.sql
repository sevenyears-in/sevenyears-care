-- Change history of business settings (targets, incentives, groups, store hours …).
-- New table only; nothing existing is changed.
create table if not exists public.settings_audit (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  user_id     text,
  user_name   text,
  area        text not null,
  action      text not null,
  before      jsonb,
  after       jsonb
);
alter table public.settings_audit enable row level security;
create index if not exists settings_audit_at_idx on public.settings_audit (at desc);
