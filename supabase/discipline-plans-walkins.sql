-- Automatic letters: two more rules (action plans, walk-in counter). Safe to run more than once.
alter table public.discipline_cases drop constraint if exists discipline_cases_track_check;
alter table public.discipline_cases add constraint discipline_cases_track_check
  check (track in ('sop_sm','late','performance','plans','walkins'));

-- When each high-priority action plan point was first shown (to count "Open for 3 days").
create table if not exists public.action_plan_seen (
  store      text not null,
  month      text not null,
  key        text not null,
  title      text,
  first_seen date not null,
  primary key (store, month, key)
);
alter table public.action_plan_seen enable row level security;
