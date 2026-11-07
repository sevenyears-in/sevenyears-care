-- Warranty editing: Store Managers can edit their store's warranties unless the
-- Super Admin switches it off; every edit records who and when.
alter table public.staff_users add column if not exists can_edit_warranties boolean not null default true;
alter table public.warranties
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by text;
