-- Automatic letters: reminders, warnings, PIP, final warning and termination (lib/discipline.ts).
-- Safe to run more than once. Does not change any existing letter.

-- New kinds of letters and the columns of automatic letters.
alter table public.warning_letters drop constraint if exists warning_letters_kind_check;
alter table public.warning_letters add constraint warning_letters_kind_check
  check (kind in ('sop','performance','attendance','conduct','other','reminder','pip','second','final','termination'));
alter table public.warning_letters add column if not exists auto boolean not null default false;
alter table public.warning_letters add column if not exists rule text;
alter table public.warning_letters add column if not exists needs text;
alter table public.warning_letters add column if not exists case_id uuid;

-- One case per person per rule (where they are in the steps).
create table if not exists public.discipline_cases (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  user_id text not null default '',
  staff_name text not null default '',
  store text,
  track text not null check (track in ('sop_sm','late','performance')),
  stage text not null default 'watching',
  status text not null default 'active' check (status in ('active','paused')),
  data jsonb not null default '{}'::jsonb,
  note text,
  paused_by text,
  last_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, track)
);
alter table public.discipline_cases enable row level security;

-- What happened in each case (letters, pauses, resets, improvements).
create table if not exists public.discipline_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.discipline_cases(id) on delete cascade,
  at timestamptz not null default now(),
  action text not null,
  letter_id uuid,
  note text,
  by_name text
);
create index if not exists discipline_events_case on public.discipline_events (case_id, at desc);
alter table public.discipline_events enable row level security;

-- The daily run (once a day, after 11 am).
create table if not exists public.discipline_runs (
  day date primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result text
);
alter table public.discipline_runs enable row level security;
