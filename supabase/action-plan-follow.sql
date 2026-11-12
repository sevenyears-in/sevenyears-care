-- Follow-up status of action plan points (Store Manager / ASM / management).
-- New table only; nothing existing is changed.
create table if not exists public.action_plan_follow (
  store       text not null,
  month       text not null,
  role        text not null,
  key         text not null,
  title       text,
  status      text not null default 'open' check (status in ('open', 'in_progress', 'done', 'not_relevant')),
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (store, month, role, key)
);
alter table public.action_plan_follow enable row level security;
