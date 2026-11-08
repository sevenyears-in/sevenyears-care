-- Who has seen each offer: on the Offers page / home page, or by tapping the notification.
create table if not exists public.offer_views (
  offer_id         uuid not null references public.offers(id) on delete cascade,
  viewer           text not null,          -- 'c:<mobile>' for a customer, 's:<staff id>' for staff
  customer_mobile  text,
  staff_id         uuid,
  first_seen_at    timestamptz not null default now(),
  tapped_at        timestamptz,            -- opened from the phone / browser notification
  primary key (offer_id, viewer)
);
create index if not exists offer_views_offer_idx on public.offer_views (offer_id);
alter table public.offer_views enable row level security;

