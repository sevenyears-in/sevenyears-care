-- Offers sent to every app user as a phone notification, and shown on /offers.
create table if not exists public.offers (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  message     text not null,
  link        text,
  valid_until date,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  sent_by     text,
  send_error  text,
  is_active   boolean not null default true
);
create index if not exists offers_created_idx on public.offers (created_at desc);
alter table public.offers enable row level security;

-- Phone notification tokens from the mobile app (who is logged in on which phone).
create table if not exists public.push_tokens (
  token          text primary key,
  platform       text not null default 'android',
  customer_mobile text,
  staff_id       uuid,
  updated_at     timestamptz not null default now()
);
create index if not exists push_tokens_customer_idx on public.push_tokens (customer_mobile);
create index if not exists push_tokens_staff_idx on public.push_tokens (staff_id);
alter table public.push_tokens enable row level security;
