-- Store opening / closing from the biometric devices (first and last punch of the day).
-- Opening = first punch − 2 minutes; closing = last punch. One row per store per day.
create table if not exists public.store_open_close (
  day                date not null,
  store              text not null,
  device             text,
  first_punch        timestamptz,
  opened_at          timestamptz,
  opened_notified_at timestamptz,
  last_punch         timestamptz,
  closed_at          timestamptz,
  closed_notified_at timestamptz,
  updated_at         timestamptz not null default now(),
  primary key (day, store)
);
alter table public.store_open_close enable row level security;
