-- =====================================================================
-- Seven Years Care — Service & Complaint workflow upgrade (Oct 2026)
-- Run ONCE in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again. Run it after supabase/setup.sql.
--
-- Adds:
--   • New staff roles (Super Admin, Store Manager, Service Head, Technician,
--     HR Head, Operations Manager) + email / WhatsApp numbers for alerts
--   • SLA / workflow fields on service requests and complaints
--   • Internal notes, staff alerts and a notification log
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Staff roles + contact details for alerts
-- ---------------------------------------------------------------------
alter table public.staff_users drop constraint if exists staff_users_role_check;
alter table public.staff_users add constraint staff_users_role_check
  check (role in ('super_admin', 'admin', 'store_manager', 'service_head',
                  'technician', 'hr_head', 'operations_manager', 'staff'));

alter table public.staff_users add column if not exists email            text;
alter table public.staff_users add column if not exists whatsapp_number  text;   -- 10 digits, no +91
alter table public.staff_users add column if not exists notify_email     boolean not null default true;
alter table public.staff_users add column if not exists notify_whatsapp  boolean not null default true;

-- Super Admin: SHAJEER ALI NV
update public.staff_users
   set role = 'super_admin'
 where full_name ilike '%shajeer%'
   and role in ('admin', 'staff');

-- If no account matched the name, the first administrator becomes Super Admin.
update public.staff_users
   set role = 'super_admin'
 where id = (select id from public.staff_users
              where role = 'admin' order by created_at limit 1)
   and not exists (select 1 from public.staff_users where role = 'super_admin');

-- ---------------------------------------------------------------------
-- 2. Service requests — workflow + SLA fields
-- ---------------------------------------------------------------------
alter table public.service_requests drop constraint if exists service_requests_status_check;
alter table public.service_requests add constraint service_requests_status_check
  check (status in ('open', 'acknowledged', 'assigned', 'in_progress',
                    'awaiting_parts', 'awaiting_approval', 'resolved',
                    'closed', 'cancelled'));

alter table public.service_requests add column if not exists priority               text not null default 'normal';
alter table public.service_requests add column if not exists severity               text;
alter table public.service_requests add column if not exists assigned_technician_id uuid references public.staff_users(id);
alter table public.service_requests add column if not exists acknowledged_at        timestamptz;
alter table public.service_requests add column if not exists acknowledged_by        uuid references public.staff_users(id);
alter table public.service_requests add column if not exists ack_due_at             timestamptz;
alter table public.service_requests add column if not exists resolution_due_at      timestamptz;
alter table public.service_requests add column if not exists resolved_at            timestamptz;
alter table public.service_requests add column if not exists closed_at              timestamptz;
alter table public.service_requests add column if not exists resolution_type        text;
alter table public.service_requests add column if not exists escalation_level       integer not null default 0;
alter table public.service_requests add column if not exists last_escalated_at      timestamptz;

alter table public.service_requests drop constraint if exists service_requests_priority_check;
alter table public.service_requests add constraint service_requests_priority_check
  check (priority in ('normal', 'high', 'safety'));
alter table public.service_requests drop constraint if exists service_requests_severity_check;
alter table public.service_requests add constraint service_requests_severity_check
  check (severity is null or severity in ('minor', 'moderate', 'major', 'installation'));

update public.service_requests set ack_due_at = created_at + interval '2 hours' where ack_due_at is null;
update public.service_requests set resolution_due_at = created_at + interval '3 days' where resolution_due_at is null;

create index if not exists service_requests_store_idx on public.service_requests (lower(store_name));
create index if not exists service_requests_tech_idx  on public.service_requests (assigned_technician_id);

-- ---------------------------------------------------------------------
-- 3. Complaints — workflow + SLA fields
-- ---------------------------------------------------------------------
alter table public.complaints drop constraint if exists complaints_status_check;
alter table public.complaints add constraint complaints_status_check
  check (status in ('open', 'acknowledged', 'under_review', 'in_progress',
                    'resolved', 'closed'));

alter table public.complaints add column if not exists store_name        text;
alter table public.complaints add column if not exists priority          text not null default 'normal';
alter table public.complaints add column if not exists severity          text;
alter table public.complaints add column if not exists owner_id          uuid references public.staff_users(id);
alter table public.complaints add column if not exists acknowledged_at   timestamptz;
alter table public.complaints add column if not exists acknowledged_by   uuid references public.staff_users(id);
alter table public.complaints add column if not exists ack_due_at        timestamptz;
alter table public.complaints add column if not exists resolution_due_at timestamptz;
alter table public.complaints add column if not exists resolved_at       timestamptz;
alter table public.complaints add column if not exists closed_at         timestamptz;
alter table public.complaints add column if not exists resolution_type   text;
alter table public.complaints add column if not exists escalation_level  integer not null default 0;
alter table public.complaints add column if not exists last_escalated_at timestamptz;

alter table public.complaints drop constraint if exists complaints_priority_check;
alter table public.complaints add constraint complaints_priority_check
  check (priority in ('normal', 'high', 'safety'));
alter table public.complaints drop constraint if exists complaints_severity_check;
alter table public.complaints add constraint complaints_severity_check
  check (severity is null or severity in ('minor', 'moderate', 'major'));

-- Copy the store name onto existing complaints (used to route them to the store manager).
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'stores') then
    execute 'update public.complaints c set store_name = s.store_name
               from public.stores s
              where c.store_id = s.id and c.store_name is null';
  end if;
end $$;

update public.complaints set ack_due_at = created_at + interval '2 hours' where ack_due_at is null;
update public.complaints set resolution_due_at = created_at + interval '3 days' where resolution_due_at is null;

create index if not exists complaints_store_idx on public.complaints (lower(store_name));

-- ---------------------------------------------------------------------
-- 4. Timeline: who did what, and whether the customer can see it
-- ---------------------------------------------------------------------
alter table public.ticket_status_history add column if not exists action     text;
alter table public.ticket_status_history add column if not exists actor_id   uuid references public.staff_users(id);
alter table public.ticket_status_history add column if not exists actor_name text;
alter table public.ticket_status_history add column if not exists visibility text not null default 'customer';

alter table public.ticket_status_history drop constraint if exists ticket_status_history_visibility_check;
alter table public.ticket_status_history add constraint ticket_status_history_visibility_check
  check (visibility in ('customer', 'internal'));

-- The app now writes the timeline itself (with the staff name and note).
-- The trigger only records "Request received" and keeps updated_at current.
create or replace function public.log_ticket_status()
returns trigger
language plpgsql
as $$
declare
  kind text := case when tg_table_name = 'service_requests' then 'service' else 'complaint' end;
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_status_history (ticket_type, ticket_id, status, note, action, visibility)
    values (kind, new.id, new.status, 'Request received', 'created', 'customer');
  elsif new is distinct from old then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Staff alerts (the bell on the staff dashboard)
-- ---------------------------------------------------------------------
create table if not exists public.staff_notifications (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references public.staff_users(id) on delete cascade,
  ticket_type    text check (ticket_type in ('service', 'complaint')),
  ticket_id      uuid,
  ticket_number  text,
  title          text not null,
  body           text,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists staff_notifications_staff_idx
  on public.staff_notifications (staff_id, read_at, created_at desc);

-- ---------------------------------------------------------------------
-- 6. Delivery log for e-mail and WhatsApp messages
-- ---------------------------------------------------------------------
create table if not exists public.notification_log (
  id             uuid primary key default gen_random_uuid(),
  channel        text not null check (channel in ('email', 'whatsapp')),
  recipient      text not null,
  audience       text not null default 'staff' check (audience in ('staff', 'customer')),
  ticket_number  text,
  subject        text,
  status         text not null check (status in ('sent', 'failed', 'skipped')),
  error          text,
  created_at     timestamptz not null default now()
);

create index if not exists notification_log_created_idx on public.notification_log (created_at desc);

alter table public.staff_notifications enable row level security;
alter table public.notification_log    enable row level security;
