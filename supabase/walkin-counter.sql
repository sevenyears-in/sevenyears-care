-- Walk-in counter: every press (+1 / −1) is kept with its time (walk-ins by hour), and the day's total in
-- walkin_counts goes up or down in the same step. client_id stops a press being counted twice when a
-- phone sends it again after being offline. Only adds a table and a function.

create table if not exists public.walkin_events (
  id         bigserial primary key,
  store      text not null,
  day        date not null,
  at         timestamptz not null default now(),
  delta      integer not null,
  by_id      uuid,
  by_name    text,
  source     text not null default 'button',
  client_id  text unique
);
alter table public.walkin_events enable row level security;
create index if not exists walkin_events_store_day_idx on public.walkin_events (store, day);

create or replace function public.walkin_add(p_store text, p_day date, p_delta integer, p_by uuid, p_name text, p_source text, p_client text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  if p_client is not null and exists (select 1 from public.walkin_events where client_id = p_client) then
    select count into n from public.walkin_counts where store = p_store and day = p_day;
    return coalesce(n, 0);
  end if;
  insert into public.walkin_events (store, day, delta, by_id, by_name, source, client_id)
    values (p_store, p_day, p_delta, p_by, p_name, p_source, p_client);
  insert into public.walkin_counts (store, day, count, updated_by, updated_by_name, updated_at)
    values (p_store, p_day, greatest(0, p_delta), p_by, p_name, now())
  on conflict (store, day) do update
    set count = greatest(0, public.walkin_counts.count + p_delta),
        updated_by = p_by, updated_by_name = p_name, updated_at = now()
  returning count into n;
  return n;
end;
$$;
