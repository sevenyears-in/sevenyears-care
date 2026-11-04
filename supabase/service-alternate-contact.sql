-- Service requests: the person to contact may not be the buyer (gifts) — keep an alternate contact too.
alter table public.service_requests add column if not exists alternate_name   text;
alter table public.service_requests add column if not exists alternate_mobile text;
create index if not exists service_requests_alt_mobile_idx on public.service_requests (alternate_mobile);
