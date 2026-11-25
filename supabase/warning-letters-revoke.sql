-- Revoke a warning letter (Super Admin, HR, Directors): kept for the record, marked revoked.
alter table public.warning_letters drop constraint if exists warning_letters_status_check;
alter table public.warning_letters add constraint warning_letters_status_check check (status in ('pending','sent','rejected','withdrawn','revoked'));
alter table public.warning_letters add column if not exists revoked_at timestamptz;
alter table public.warning_letters add column if not exists revoked_by_name text;
alter table public.warning_letters add column if not exists revoke_reason text;
