-- Stock per store (read from Zoho POS every night, or uploaded from Excel), stock-out days,
-- month-opening stock, uploaded sales history (for LFL / MoM when the API has not copied it yet),
-- and one function that adds up sales per item for a store and period.
-- Only adds new tables, indexes and a function: no existing data is changed.

create table if not exists public.stock_levels (
  store       text not null,
  item_id     text not null,
  sku         text,
  name        text,
  category    text,
  rate        numeric,
  stock       numeric not null default 0,
  out_since   date,
  source      text not null default 'zoho',
  updated_at  timestamptz not null default now(),
  primary key (store, item_id)
);
alter table public.stock_levels enable row level security;
create index if not exists stock_levels_sku_idx on public.stock_levels (sku);

create table if not exists public.stock_month_open (
  month    text not null,
  store    text not null,
  item_id  text not null,
  stock    numeric not null,
  primary key (month, store, item_id)
);
alter table public.stock_month_open enable row level security;

create table if not exists public.stock_out_days (
  day      date not null,
  store    text not null,
  item_id  text not null,
  primary key (day, store, item_id)
);
alter table public.stock_out_days enable row level security;

create table if not exists public.sales_history_lines (
  id          bigserial primary key,
  day         date not null,
  store       text not null,
  item_id     text,
  sku         text,
  name        text not null,
  category    text,
  quantity    numeric not null default 0,
  net         numeric not null default 0,
  upload_id   text,
  created_at  timestamptz not null default now()
);
alter table public.sales_history_lines enable row level security;
create index if not exists sales_history_lines_store_day_idx on public.sales_history_lines (store, day);

create index if not exists sales_invoice_lines_store_date_idx on public.sales_invoice_lines (store, invoice_date);
create index if not exists sales_return_lines_store_date_idx on public.sales_return_lines (store, return_date);

-- Sales per item (with GST, returns taken off) for one store and period, as one JSON array.
-- Uploaded history counts only for days with no bills copied from Zoho for that store.
create or replace function public.merch_item_sales(p_store text, p_from date, p_to date)
returns jsonb
language sql
stable
as $$
  with s as (
    select coalesce(item_id, 'sku:' || coalesce(sku, name)) as k, max(name) as name, max(sku) as sku, max(category) as category,
           sum(quantity) as units, sum(coalesce(total, net)) as net
    from public.sales_invoice_lines
    where store = p_store and invoice_date between p_from and p_to
    group by 1
  ), r as (
    select coalesce(item_id, 'sku:' || coalesce(sku, name)) as k, sum(quantity) as units, sum(coalesce(total, net)) as net
    from public.sales_return_lines
    where store = p_store and return_date between p_from and p_to
    group by 1
  ), h as (
    select coalesce(item_id, 'sku:' || coalesce(sku, name)) as k, max(name) as name, max(sku) as sku, max(category) as category,
           sum(quantity) as units, sum(net) as net
    from public.sales_history_lines hl
    where hl.store = p_store and hl.day between p_from and p_to
      and not exists (select 1 from public.sales_invoices i where i.store = hl.store and i.invoice_date = hl.day)
    group by 1
  ), u as (
    select k, name, sku, category, units, net from s
    union all select k, null, null, null, -units, -net from r
    union all select k, name, sku, category, units, net from h
  )
  select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', name, 's', sku, 'c', category, 'u', units, 'v', net)), '[]'::jsonb)
  from (select k, max(name) as name, max(sku) as sku, max(category) as category, sum(units) as units, sum(net) as net from u group by k) t;
$$;

-- Days in a period that have sales data for a store (bills copied, or uploaded history).
create or replace function public.merch_days_with_data(p_store text, p_from date, p_to date)
returns integer
language sql
stable
as $$
  select count(*)::int from (
    select invoice_date as d from public.sales_invoices where store = p_store and invoice_date between p_from and p_to
    union
    select day from public.sales_history_lines where store = p_store and day between p_from and p_to
  ) x;
$$;
