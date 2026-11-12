-- Walk-ins per store and day, posted by the CRE (running total for the day). Only adds a new table.
create table if not exists public.walkin_counts (
  store           text not null,
  day             date not null,
  count           integer not null check (count >= 0),
  updated_by      uuid,
  updated_by_name text,
  updated_at      timestamptz not null default now(),
  primary key (store, day)
);
alter table public.walkin_counts enable row level security;
