-- =====================================================================
-- Seven Years Care — customer portal, CSA/CRE roles, WhatsApp/Aira (Nov 2026)
-- Run ONCE in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again.
-- =====================================================================

-- 1. Staff roles: add CSA and CRE; the old "Store Staff" becomes CSA.
alter table public.staff_users drop constraint if exists staff_users_role_check;
alter table public.staff_users add constraint staff_users_role_check
  check (role in ('super_admin', 'admin', 'store_manager', 'service_head',
                  'technician', 'hr_head', 'operations_manager', 'cre', 'csa', 'staff'));

update public.staff_users set role = 'csa' where role = 'staff';

-- 2. Customer logins (User ID = mobile number).
create table if not exists public.customer_accounts (
  mobile               text primary key check (mobile ~ '^[6-9][0-9]{9}$'),
  full_name            text,
  password_hash        text not null,
  session_version      integer not null default 1,
  failed_attempts      integer not null default 0,
  locked_until         timestamptz,
  password_changed_at  timestamptz,
  last_login_at        timestamptz,
  created_at           timestamptz not null default now()
);
alter table public.customer_accounts enable row level security;

-- 3. Where a complaint came from: web, whatsapp or aira.
alter table public.complaints add column if not exists source text not null default 'web';

-- 4. WhatsApp complaint bot: one conversation per mobile number.
create table if not exists public.whatsapp_sessions (
  mobile      text primary key,
  state       text not null default 'idle',
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.whatsapp_sessions enable row level security;
