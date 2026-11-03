-- =====================================================================
-- Seven Years Care — HR Executive, Directors at Corporate Office, customer feedback (Nov 2026)
-- Run ONCE in Supabase: Dashboard → SQL Editor → New query → paste → Run. Safe to run again.
-- =====================================================================

-- 1. Roles: add HR Executive.
alter table public.staff_users drop constraint if exists staff_users_role_check;
alter table public.staff_users add constraint staff_users_role_check
  check (role in ('super_admin', 'admin', 'director', 'store_manager', 'service_head',
                  'technician', 'hr_head', 'hr_executive', 'operations_manager', 'cre',
                  'floor_incharge', 'csa', 'staff'));

-- 2. Directors belong to the Corporate Office (the stores they look after stay in director_stores).
update public.staff_users set store_name = 'CORPORATE OFFICE' where role = 'director';

-- 3. Complaint severities: critical / high / normal (old values still allowed).
alter table public.complaints drop constraint if exists complaints_severity_check;
alter table public.complaints add constraint complaints_severity_check
  check (severity is null or severity in ('critical', 'high', 'normal', 'minor', 'moderate', 'major'));

-- 4. Customer feedback (sales, service, complaint handling).
create table if not exists public.customer_feedback (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('sales', 'service', 'complaint')),
  ref_id            uuid not null,
  ref_number        text not null,
  mobile            text,
  store_name        text,
  staff_name        text,
  confidential      boolean not null default false,
  answers           jsonb not null default '{}'::jsonb,
  overall           numeric(3,1),
  resolved          text check (resolved in ('yes', 'partly', 'no')),
  comment           text,
  needs_followup    boolean not null default false,
  followup_done_at  timestamptz,
  followup_by       text,
  followup_note     text,
  rated_at          timestamptz,
  created_at        timestamptz not null default now(),
  unique (kind, ref_id)
);
create index if not exists customer_feedback_store_idx  on public.customer_feedback (store_name, created_at desc);
create index if not exists customer_feedback_mobile_idx on public.customer_feedback (mobile);
create index if not exists customer_feedback_bill_idx   on public.customer_feedback (kind, ref_number);
alter table public.customer_feedback enable row level security;

-- 5. Alerts that are not about a ticket (e.g. sales feedback follow-ups).
alter table public.staff_notifications alter column ticket_type drop not null;
