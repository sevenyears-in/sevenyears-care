-- 3-month normal warranty (chosen by the Store Manager at registration; only the Super Admin can change it later).
-- Old warranties keep these empty = the category's normal period (6 months). Nothing existing is changed.
alter table public.warranties add column if not exists standard_months smallint check (standard_months between 1 and 120);
alter table public.warranties add column if not exists short_warranty_reason text;
alter table public.warranties add column if not exists short_warranty_by text;
create index if not exists warranties_standard_months_idx on public.warranties (standard_months) where standard_months is not null;
