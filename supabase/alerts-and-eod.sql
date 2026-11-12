-- Sales update alerts (one row per day + time slot: stops the same alert being sent twice)
-- and end-of-day reports per store (one row per day + store). Only adds new tables.

create table if not exists public.performance_alert_runs (
  day          date not null,
  slot         text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running',
  stale        boolean,
  last_sync_at timestamptz,
  result       jsonb,
  primary key (day, slot)
);
alter table public.performance_alert_runs enable row level security;

create table if not exists public.daily_store_reports (
  day            date not null,
  store          text not null,
  status         text not null default 'generating' check (status in ('generating', 'provisional', 'final', 'failed')),
  data           jsonb,
  generated_at   timestamptz,
  regenerated_at timestamptz,
  emailed_at     timestamptz,
  email_result   jsonb,
  error          text,
  primary key (day, store)
);
alter table public.daily_store_reports enable row level security;
