-- Where a warranty came from: 'store' (registered at the counter) or 'zoho_import'.
alter table public.warranties add column if not exists source text not null default 'store';
update public.warranties set source = 'zoho_import'
  where source = 'store' and serial_number = 'Not recorded';

-- Store x bill-month counts for the Warranties page (fast, done in the database).
create or replace function public.warranty_month_summary(p_from date default null, p_to date default null, p_store text default null)
returns table (store_name text, month text, total bigint)
language sql stable
as $$
  select coalesce(nullif(trim(w.store_name), ''), 'Not specified') as store_name,
         to_char(w.bill_date, 'YYYY-MM') as month,
         count(*) as total
  from public.warranties w
  where (p_from is null or w.bill_date >= p_from)
    and (p_to is null or w.bill_date <= p_to)
    and (p_store is null or w.store_name ilike p_store)
  group by 1, 2
  order by 1, 2;
$$;
revoke all on function public.warranty_month_summary(date, date, text) from public, anon, authenticated;
grant execute on function public.warranty_month_summary(date, date, text) to service_role;
