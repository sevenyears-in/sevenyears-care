-- =====================================================================
-- Seven Years Care — Directors, staff explanations, complaint staff (Nov 2026)
-- Run ONCE in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again.
-- =====================================================================

-- 1. Roles: add Director and Floor Incharge.
alter table public.staff_users drop constraint if exists staff_users_role_check;
alter table public.staff_users add constraint staff_users_role_check
  check (role in ('super_admin', 'admin', 'director', 'store_manager', 'service_head',
                  'technician', 'hr_head', 'operations_manager', 'cre', 'floor_incharge',
                  'csa', 'staff'));

-- Directors can look after several stores; temporary passwords must be changed.
alter table public.staff_users add column if not exists director_stores      text[] not null default '{}';
alter table public.staff_users add column if not exists must_change_password boolean not null default false;

-- 2. Customer e-mail (to prefill forms in My Account).
alter table public.customer_accounts add column if not exists email text;

-- 3. Complaints: the bill and the staff member who made the sale.
alter table public.complaints add column if not exists bill_number          text;
alter table public.complaints add column if not exists involved_staff_name  text;
alter table public.complaints add column if not exists involved_staff_id    uuid references public.staff_users(id);

-- 4. Staff explanations (asked by Directors / managers, or automatically for complaints).
create table if not exists public.ticket_explanations (
  id                 uuid primary key default gen_random_uuid(),
  ticket_type        text not null check (ticket_type in ('service', 'complaint')),
  ticket_id          uuid not null,
  ticket_number      text not null,
  staff_id           uuid not null references public.staff_users(id),
  staff_name         text not null,
  reason             text not null,
  requested_by       uuid references public.staff_users(id),
  requested_by_name  text,
  requested_at       timestamptz not null default now(),
  explanation        text,
  explained_at       timestamptz
);
create index if not exists ticket_explanations_staff_idx  on public.ticket_explanations (staff_id, explained_at);
create index if not exists ticket_explanations_ticket_idx on public.ticket_explanations (ticket_type, ticket_id);
alter table public.ticket_explanations enable row level security;
