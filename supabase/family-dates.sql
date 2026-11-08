-- Family dates (children's birthdays, parents' birthdays, wedding anniversary), one row per customer mobile.
create table if not exists public.customer_family (
  mobile       text primary key,
  children     jsonb not null default '[]'::jsonb,   -- [{ "name": "Aisha", "dob": "2024-03-15" }]
  father_dob   date,
  mother_dob   date,
  anniversary  date,
  updated_by   text,
  updated_at   timestamptz not null default now()
);
alter table public.customer_family enable row level security;
