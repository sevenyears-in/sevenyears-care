-- =====================================================================
-- Seven Years Care — database setup
-- Run in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run more than once. Works whether or not you already ran the
-- older "service-and-complaints.sql".
-- AFTER this, also run supabase/workflow-upgrade.sql (roles, workflow, alerts).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Staff users (log in with User ID + password)
--    Passwords are stored as salted scrypt hashes by the app — never plain text.
-- ---------------------------------------------------------------------
create table if not exists public.staff_users (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null unique,              -- what staff type to log in (lower-case)
  full_name      text not null,
  password_hash  text not null,
  role           text not null default 'staff' check (role in ('admin', 'staff')),
  store_name     text,                              -- default store printed on certificates
  is_active      boolean not null default true,
  session_version integer not null default 1,       -- bump to log a user out everywhere
  last_login_at  timestamptz,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Zoho POS categories that are eligible for warranty
--    Managed from the app: Staff → Admin → Warranty Categories
-- ---------------------------------------------------------------------
create table if not exists public.warranty_categories (
  id                  uuid primary key default gen_random_uuid(),
  category_name       text not null,
  standard_months     integer not null default 6 check (standard_months between 1 and 120),
  extended_allowed    boolean not null default true,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

create unique index if not exists warranty_categories_name_uq
  on public.warranty_categories (lower(category_name));

-- ---------------------------------------------------------------------
-- 3. Warranties — one row per item unit (qty 2 = 2 warranties)
-- ---------------------------------------------------------------------
create table if not exists public.warranties (
  id                              uuid primary key default gen_random_uuid(),
  warranty_number                 text not null unique,
  verification_token              text not null unique default encode(gen_random_bytes(16), 'hex'),

  -- Bill (from Zoho POS)
  zoho_invoice_id                 text,
  bill_number                     text not null,
  bill_date                       date not null,
  store_name                      text,

  -- Item
  zoho_line_item_id               text not null,
  zoho_item_id                    text,
  unit_index                      integer not null default 1,
  product_name                    text not null,
  sku                             text,
  category_name                   text,
  model_number                    text not null,
  serial_number                   text not null,

  -- Customer (entered/confirmed by staff)
  customer_name                   text not null,
  customer_mobile                 text not null,     -- 10 digits, no +91
  customer_address                text not null,

  -- Coverage
  warranty_start_date             date not null,
  standard_warranty_expiry_date   date not null,
  extended_warranty_purchased     boolean not null default false,
  extended_warranty_fee           numeric(10,2) not null default 0,
  extended_warranty_start_date    date,
  extended_warranty_expiry_date   date,
  warranty_expiry_date            date not null,
  status                          text not null default 'active'
                                    check (status in ('active', 'void')),

  registered_by                   uuid references public.staff_users(id),
  created_at                      timestamptz not null default now(),

  -- the same unit of the same bill line can't be registered twice
  unique (bill_number, bill_date, zoho_line_item_id, unit_index)
);

create index if not exists warranties_mobile_idx on public.warranties (customer_mobile);
create index if not exists warranties_bill_idx   on public.warranties (bill_number, bill_date);
create index if not exists warranties_serial_idx on public.warranties (lower(serial_number));

-- ---------------------------------------------------------------------
-- 4. Service requests (customer-raised, against a warranty)
--    Customer location (optional) is captured here, not at registration.
-- ---------------------------------------------------------------------
create table if not exists public.service_requests (
  id                         uuid primary key default gen_random_uuid(),
  request_number             text not null unique,
  warranty_id                uuid references public.warranties(id),
  contact_name               text,
  contact_mobile             text,
  product_name               text,
  store_name                 text,
  issue_type                 text not null,
  description                text not null,
  service_mode               text not null default 'store_visit'
                               check (service_mode in ('store_visit', 'home_visit')),
  preferred_date             date,
  address                    text,
  under_warranty             boolean not null default true,
  latitude                   double precision,
  longitude                  double precision,
  location_accuracy_meters   double precision,
  status                     text not null default 'open'
                               check (status in ('open', 'assigned', 'in_progress',
                                                 'awaiting_parts', 'resolved',
                                                 'closed', 'cancelled')),
  assigned_to                text,
  resolution_notes           text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- If the older script already created service_requests, bring it up to date.
alter table public.service_requests add column if not exists warranty_id    uuid references public.warranties(id);
alter table public.service_requests add column if not exists contact_name   text;
alter table public.service_requests add column if not exists contact_mobile text;
alter table public.service_requests add column if not exists product_name   text;
alter table public.service_requests add column if not exists store_name     text;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'service_requests'
               and column_name = 'warranty_registration_id') then
    execute 'alter table public.service_requests alter column warranty_registration_id drop not null';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'service_requests'
               and column_name = 'customer_id') then
    execute 'alter table public.service_requests alter column customer_id drop not null';
  end if;
end $$;

create index if not exists service_requests_warranty2_idx on public.service_requests (warranty_id);
create index if not exists service_requests_mobile_idx    on public.service_requests (contact_mobile);
create index if not exists service_requests_status_idx    on public.service_requests (status);

-- ---------------------------------------------------------------------
-- 5. Complaints
-- ---------------------------------------------------------------------
create table if not exists public.complaints (
  id                         uuid primary key default gen_random_uuid(),
  complaint_number           text not null unique,
  customer_id                uuid references public.customers(id),
  contact_name               text not null,
  contact_mobile             text,
  contact_email              text,
  store_id                   uuid references public.stores(id),
  warranty_id                uuid references public.warranties(id),
  category                   text not null,
  reference_number           text,
  description                text not null,
  status                     text not null default 'open'
                               check (status in ('open', 'under_review', 'in_progress',
                                                 'resolved', 'closed')),
  assigned_to                text,
  resolution_notes           text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

alter table public.complaints add column if not exists contact_mobile text;
alter table public.complaints add column if not exists warranty_id    uuid references public.warranties(id);
alter table public.complaints alter column customer_id drop not null;

create index if not exists complaints_status_idx on public.complaints (status);
create index if not exists complaints_mobile_idx on public.complaints (contact_mobile);

-- ---------------------------------------------------------------------
-- 6. Status history (timeline on Track Request) + triggers
-- ---------------------------------------------------------------------
create table if not exists public.ticket_status_history (
  id           uuid primary key default gen_random_uuid(),
  ticket_type  text not null check (ticket_type in ('service', 'complaint')),
  ticket_id    uuid not null,
  status       text not null,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists ticket_status_history_ticket_idx
  on public.ticket_status_history (ticket_type, ticket_id, created_at);

create or replace function public.log_ticket_status()
returns trigger
language plpgsql
as $$
declare
  kind text := case when tg_table_name = 'service_requests' then 'service' else 'complaint' end;
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_status_history (ticket_type, ticket_id, status, note)
    values (kind, new.id, new.status, 'Request received');
  elsif new.status is distinct from old.status then
    new.updated_at := now();
    insert into public.ticket_status_history (ticket_type, ticket_id, status, note)
    values (kind, new.id, new.status,
            case when new.resolution_notes is distinct from old.resolution_notes
                 then new.resolution_notes end);
  elsif new is distinct from old then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists service_requests_status_log_ins on public.service_requests;
create trigger service_requests_status_log_ins
  after insert on public.service_requests
  for each row execute function public.log_ticket_status();

drop trigger if exists service_requests_status_log_upd on public.service_requests;
create trigger service_requests_status_log_upd
  before update on public.service_requests
  for each row execute function public.log_ticket_status();

drop trigger if exists complaints_status_log_ins on public.complaints;
create trigger complaints_status_log_ins
  after insert on public.complaints
  for each row execute function public.log_ticket_status();

drop trigger if exists complaints_status_log_upd on public.complaints;
create trigger complaints_status_log_upd
  before update on public.complaints
  for each row execute function public.log_ticket_status();

-- ---------------------------------------------------------------------
-- 7. App settings (Zoho POS connection saved from Staff → Zoho POS)
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 8. Security: server-only tables (the app uses the secret key).
--    The public key gets no access to any of these.
-- ---------------------------------------------------------------------
alter table public.staff_users            enable row level security;
alter table public.warranty_categories    enable row level security;
alter table public.warranties             enable row level security;
alter table public.service_requests       enable row level security;
alter table public.complaints             enable row level security;
alter table public.ticket_status_history  enable row level security;
alter table public.app_settings           enable row level security;
