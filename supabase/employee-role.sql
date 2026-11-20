-- Built-in role "employee": staff with no work in the app (housekeeping, backend, VM ...).
-- They see only their own performance, incentives and duties; no service / complaint / warranty work or alerts.
alter table public.staff_users drop constraint if exists staff_users_role_check;
alter table public.staff_users add constraint staff_users_role_check
  check (role in ('super_admin', 'admin', 'director', 'store_manager', 'service_head',
                  'technician', 'hr_head', 'hr_executive', 'operations_manager', 'cre',
                  'floor_incharge', 'csa', 'employee', 'staff'));
