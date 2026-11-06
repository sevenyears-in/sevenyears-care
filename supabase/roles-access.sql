-- Roles & Access: a staff member's custom role (from Settings) and extra sections.
alter table public.staff_users
  add column if not exists custom_role_id text,
  add column if not exists extra_sections text[] not null default '{}';
