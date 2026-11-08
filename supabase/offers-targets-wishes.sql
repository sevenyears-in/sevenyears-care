-- Offers for chosen customers, and automatic birthday / anniversary wishes.
alter table public.offers
  add column if not exists audience text not null default 'all',      -- 'all' or 'selected'
  add column if not exists target_mobiles text[] not null default '{}';

-- One row per wish sent, so nobody gets the same wish twice in a day.
create table if not exists public.customer_wishes_sent (
  id         bigserial primary key,
  mobile     text not null,
  kind       text not null,          -- child_birthday | father_birthday | mother_birthday | anniversary
  detail     text not null default '',
  wish_date  date not null,
  sent       boolean not null default false,
  error      text,
  created_at timestamptz not null default now(),
  unique (mobile, kind, detail, wish_date)
);
create index if not exists customer_wishes_sent_date_idx on public.customer_wishes_sent (wish_date desc);
alter table public.customer_wishes_sent enable row level security;
