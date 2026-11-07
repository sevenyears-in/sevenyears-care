-- Attendance from eTimeTrackLite (synced every 2 minutes from the office PC).
create table if not exists public.attendance_punches (
  id bigserial primary key,
  source_id text not null unique,           -- eTimeTrackLite table + DeviceLogId, so nothing is saved twice
  emp_code text not null,                   -- eTimeTrackLite user / employee code
  punch_time timestamptz not null,
  device text,
  direction text,
  created_at timestamptz not null default now()
);
create index if not exists attendance_punches_time_idx on public.attendance_punches (punch_time desc);
create index if not exists attendance_punches_code_idx on public.attendance_punches (emp_code, punch_time desc);
alter table public.attendance_punches enable row level security;

alter table public.staff_users add column if not exists employee_code text;
create index if not exists staff_users_employee_code_idx on public.staff_users (employee_code);
