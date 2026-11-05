-- Paid service: products bought elsewhere / without a Seven Years warranty,
-- and the repair quote the customer approves online.
alter table public.service_requests
  add column if not exists paid boolean not null default false,
  add column if not exists brand text,
  add column if not exists model_number text,
  add column if not exists purchased_from text,
  add column if not exists quote_amount numeric(10,2),
  add column if not exists quote_note text,
  add column if not exists quote_status text check (quote_status in ('pending', 'approved', 'declined')),
  add column if not exists quote_sent_at timestamptz,
  add column if not exists quote_decided_at timestamptz,
  add column if not exists quote_by text;
