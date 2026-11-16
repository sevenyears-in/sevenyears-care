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

-- Who opened / closed and the SOP check (SM or ASM / FM only; Director approves deviations).
alter table public.store_open_close add column if not exists opened_by text;
alter table public.store_open_close add column if not exists opened_by_name text;
alter table public.store_open_close add column if not exists open_sop text check (open_sop in ('ok','violation','approved'));
alter table public.store_open_close add column if not exists open_sop_note text;
alter table public.store_open_close add column if not exists open_approved_by text;
alter table public.store_open_close add column if not exists open_approved_at timestamptz;
alter table public.store_open_close add column if not exists open_approval_note text;
alter table public.store_open_close add column if not exists closed_by text;
alter table public.store_open_close add column if not exists closed_by_name text;
alter table public.store_open_close add column if not exists close_sop text check (close_sop in ('ok','violation','approved'));
alter table public.store_open_close add column if not exists close_sop_note text;
alter table public.store_open_close add column if not exists close_approved_by text;
alter table public.store_open_close add column if not exists close_approved_at timestamptz;
alter table public.store_open_close add column if not exists close_approval_note text;
