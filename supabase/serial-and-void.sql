-- 1) Automatic warranty serial numbers: SY-SN-<year>-<6-digit running number>
create sequence if not exists public.warranty_serial_seq;

create or replace function public.warranty_auto_serial()
returns trigger language plpgsql as $$
begin
  if new.serial_number is null or btrim(new.serial_number) in ('', 'Not recorded') then
    new.serial_number := 'SY-SN-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' ||
                         lpad(nextval('public.warranty_serial_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists warranty_auto_serial on public.warranties;
create trigger warranty_auto_serial before insert on public.warranties
  for each row execute function public.warranty_auto_serial();

-- Existing warranties: number them in bill-date order.
with ordered as (
  select id, created_at, row_number() over (order by bill_date, created_at, warranty_number) as rn
  from public.warranties
)
update public.warranties w
   set serial_number = 'SY-SN-' || to_char(o.created_at at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(o.rn::text, 6, '0')
  from ordered o
 where w.id = o.id;

select setval('public.warranty_serial_seq', greatest((select count(*) from public.warranties), 1));

-- 2) Void a warranty (Super Admin), with the reason.
alter table public.warranties
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by text;
