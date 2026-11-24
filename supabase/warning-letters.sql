-- Warning letters to staff (SOP violations, performance, attendance, conduct …).
-- Super Admin, HR and Directors send directly; a Store Manager's letter waits for HR / a Director.
-- The staff member gets it in the app (alert + phone notification) and by e-mail with a PDF,
-- and acknowledges it in the app ("I have read this letter"), optionally with a reply.

create table if not exists public.warning_letters (
  id               uuid primary key default gen_random_uuid(),
  number           text unique,
  staff_id         uuid not null references public.staff_users(id),
  user_id          text not null,
  staff_name       text not null,
  store            text,
  designation      text,
  kind             text not null check (kind in ('sop','performance','attendance','conduct','other')),
  subject          text not null,
  body             text not null,
  status           text not null default 'pending' check (status in ('pending','sent','rejected','withdrawn')),
  created_by       uuid references public.staff_users(id),
  created_by_name  text,
  created_by_role  text,
  created_at       timestamptz not null default now(),
  decided_by_name  text,
  decided_at       timestamptz,
  reject_reason    text,
  issued_by_name   text,
  issued_by_role   text,
  sent_at          timestamptz,
  email_status     text,
  ack_at           timestamptz,
  ack_note         text
);
create index if not exists warning_letters_staff_idx on public.warning_letters (staff_id, created_at desc);
create index if not exists warning_letters_status_idx on public.warning_letters (status, created_at desc);
alter table public.warning_letters enable row level security;
