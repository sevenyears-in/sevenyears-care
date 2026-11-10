-- Sales performance dashboard: bills and returns copied from Zoho POS, staff targets and
-- the Slow-moving / Buy 2 Get 1 product lists. Only numbers, items and staff are kept here,
-- no customer names or phone numbers.

create table if not exists public.sales_invoices (
  invoice_id      text primary key,
  invoice_number  text not null,
  invoice_date    date not null,
  store           text,                 -- store name as in Staff Users (e.g. VADAKARA)
  location_name   text,                 -- raw Zoho location / branch
  salesperson     text,                 -- raw Zoho salesperson ("1014 - JIYANA")
  staff_user_id   text,                 -- staff User ID taken from the salesperson ("1014"), null = "Others"
  status          text,
  gross           numeric not null default 0,  -- before discount, without tax
  discount        numeric not null default 0,  -- item + bill discounts, without tax
  net             numeric not null default 0,  -- after discount, without tax
  total           numeric not null default 0,  -- bill amount the customer paid (with tax)
  quantity        numeric not null default 0,
  line_count      int not null default 0,
  category_count  int not null default 0,
  units_under_5k  numeric not null default 0,  -- units priced below ₹5,000 (WOW bill rule)
  max_line_share  numeric not null default 0,  -- biggest single line as a share of the bill (0-1)
  modified_at     text,
  synced_at       timestamptz not null default now()
);
create index if not exists sales_invoices_date_idx on public.sales_invoices (invoice_date);
create index if not exists sales_invoices_staff_idx on public.sales_invoices (staff_user_id, invoice_date);
create index if not exists sales_invoices_store_idx on public.sales_invoices (store, invoice_date);
alter table public.sales_invoices enable row level security;

create table if not exists public.sales_invoice_lines (
  line_item_id   text primary key,
  invoice_id     text not null references public.sales_invoices(invoice_id) on delete cascade,
  invoice_date   date not null,
  staff_user_id  text,
  store          text,
  item_id        text,
  sku            text,
  name           text,
  category       text,
  quantity       numeric not null default 0,
  price          numeric not null default 0,  -- price per unit as on the bill (with tax)
  discount       numeric not null default 0,  -- discount on this line, without tax
  net            numeric not null default 0   -- line amount after discount, without tax
);
create index if not exists sales_invoice_lines_invoice_idx on public.sales_invoice_lines (invoice_id);
create index if not exists sales_invoice_lines_staff_idx on public.sales_invoice_lines (staff_user_id, invoice_date);
create index if not exists sales_invoice_lines_item_idx on public.sales_invoice_lines (item_id);
alter table public.sales_invoice_lines enable row level security;

-- Returns / exchanges (Zoho credit notes)
create table if not exists public.sales_returns (
  creditnote_id     text primary key,
  creditnote_number text not null,
  return_date       date not null,
  store             text,
  location_name     text,
  salesperson       text,
  staff_user_id     text,
  invoice_id        text,               -- the bill it was returned against, when Zoho has it
  invoice_number    text,
  status            text,
  net               numeric not null default 0,  -- without tax
  total             numeric not null default 0,  -- with tax
  modified_at       text,
  synced_at         timestamptz not null default now()
);
create index if not exists sales_returns_date_idx on public.sales_returns (return_date);
create index if not exists sales_returns_staff_idx on public.sales_returns (staff_user_id, return_date);
create index if not exists sales_returns_invoice_idx on public.sales_returns (invoice_id);
alter table public.sales_returns enable row level security;

create table if not exists public.sales_return_lines (
  line_item_id   text primary key,
  creditnote_id  text not null references public.sales_returns(creditnote_id) on delete cascade,
  return_date    date not null,
  staff_user_id  text,
  store          text,
  item_id        text,
  sku            text,
  name           text,
  quantity       numeric not null default 0,
  net            numeric not null default 0
);
create index if not exists sales_return_lines_cn_idx on public.sales_return_lines (creditnote_id);
create index if not exists sales_return_lines_item_idx on public.sales_return_lines (item_id);
alter table public.sales_return_lines enable row level security;

-- Item → category (filled while syncing, so each item is looked up in Zoho only once)
create table if not exists public.sales_item_categories (
  item_id    text primary key,
  category   text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.sales_item_categories enable row level security;

-- Individual monthly targets
create table if not exists public.staff_sales_targets (
  user_id     text not null,           -- staff User ID ("1014")
  month       text not null,           -- YYYY-MM
  sales_target numeric not null default 0,
  abv_target   numeric,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (user_id, month)
);
alter table public.staff_sales_targets enable row level security;

-- Store targets per month (the defaults are in Settings; a row here overrides one month)
create table if not exists public.store_sales_targets (
  store       text not null,
  month       text not null,
  target      numeric not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (store, month)
);
alter table public.store_sales_targets enable row level security;

-- Slow-moving and Buy 2 Get 1 products
create table if not exists public.promo_products (
  id          bigserial primary key,
  kind        text not null check (kind in ('slow_moving', 'b2g1')),
  item_id     text,
  sku         text,
  name        text not null,
  from_date   date,
  to_date     date,
  created_at  timestamptz not null default now(),
  created_by  text
);
create unique index if not exists promo_products_kind_item_idx on public.promo_products (kind, coalesce(item_id, sku, name));
alter table public.promo_products enable row level security;

-- Which incentive group a person belongs to (Sales Team, Cashier & CRE, Backend ...)
alter table public.staff_users add column if not exists incentive_group text;

-- Product lists are keyed by incentive (any name), not only slow_moving / b2g1.
alter table public.promo_products drop constraint if exists promo_products_kind_check;

-- Monthly salary of each person (for the management view: sales for every ₹1 of salary).
create table if not exists public.staff_salaries (
  user_id         text primary key,          -- staff User ID or PT code
  monthly_salary  numeric not null default 0,
  updated_at      timestamptz not null default now(),
  updated_by      text
);
alter table public.staff_salaries enable row level security;

-- Absent days justified by HR or the Store Manager (they count as duties).
create table if not exists public.duty_justifications (
  user_id     text not null,              -- staff User ID or PT code
  day         date not null,
  kind        text not null,              -- leave | official | missed_punch | week_off | other
  reason      text,
  by_name     text not null,
  by_role     text,
  created_at  timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.duty_justifications enable row level security;
