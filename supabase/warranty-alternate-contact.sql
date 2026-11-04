-- Gift purchases: the person who will use the product (alternate contact).
alter table public.warranties add column if not exists alternate_name text;
alter table public.warranties add column if not exists alternate_mobile text;
create index if not exists warranties_alt_mobile_idx on public.warranties (alternate_mobile);
