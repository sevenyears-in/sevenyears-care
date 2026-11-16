-- Purchase cost per item (Zoho purchase rate), for the stock value at cost.
alter table public.stock_levels add column if not exists cost numeric;
