-- =====================================================================
-- Seven Years Care — extended warranty bought after the purchase (Nov 2026)
-- Run ONCE in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
-- =====================================================================

create table if not exists public.warranty_extensions (
  id                   uuid primary key default gen_random_uuid(),
  warranty_id          uuid not null references public.warranties(id) on delete cascade,
  warranty_number      text not null,
  kind                 text not null check (kind in ('direct', 'inspection')),
  status               text not null check (status in ('pending_inspection', 'inspection_failed', 'awaiting_payment', 'paid', 'cancelled')),
  price                numeric(10,2) not null,
  months               integer not null default 6,
  store_name           text,
  customer_name        text,
  customer_mobile      text,
  product_name         text,
  customer_note        text,
  inspection_note      text,
  inspected_by         uuid references public.staff_users(id),
  inspected_by_name    text,
  inspected_at         timestamptz,
  razorpay_order_id    text,
  razorpay_payment_id  text,
  payment_mode         text check (payment_mode in ('online', 'store')),
  paid_marked_by       text,
  paid_at              timestamptz,
  created_at           timestamptz not null default now()
);
create index if not exists warranty_extensions_warranty_idx on public.warranty_extensions (warranty_id, created_at desc);
create index if not exists warranty_extensions_status_idx   on public.warranty_extensions (status, store_name);
create unique index if not exists warranty_extensions_order_idx on public.warranty_extensions (razorpay_order_id) where razorpay_order_id is not null;
alter table public.warranty_extensions enable row level security;

-- New price ₹1,499 (+6 months). The Super Admin can change it later on Settings → Extended Warranty & Payments.
insert into public.app_settings (key, value, updated_at)
values ('extended_warranty', '{"price": 1499, "months": 6, "windowDays": 10, "onlineEnabled": false}'::jsonb, now())
on conflict (key) do nothing;

-- Which payment company handled the payment (razorpay / paytm / icici).
-- (razorpay_order_id holds the order / reference number for all three.)
alter table public.warranty_extensions add column if not exists gateway text;
