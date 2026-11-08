-- "Online now": when each staff member / customer last had the app or website open.
alter table public.staff_users       add column if not exists last_seen_at timestamptz;
alter table public.customer_accounts add column if not exists last_seen_at timestamptz;
