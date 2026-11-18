-- Shift and store of each staff member over time ("valid from"), so history stays right:
-- a new shift or a transfer applies from its date; earlier days keep the earlier shift / store.
create table if not exists public.staff_assignments (
  id          bigserial primary key,
  user_id     text not null,                               -- staff User ID (= eTimeTrackLite employee code)
  kind        text not null check (kind in ('shift', 'store')),
  value       text not null,                               -- shift name, or store name
  valid_from  date not null,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  unique (user_id, kind, valid_from)
);
create index if not exists staff_assignments_user_idx on public.staff_assignments (user_id, kind, valid_from);
alter table public.staff_assignments enable row level security;
