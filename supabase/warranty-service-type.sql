-- Warranty service type (On-Site / In-Store), chosen per product when a warranty is issued.
-- Adds an empty column only: warranties issued before this keep NULL and are not changed.
alter table public.warranties
  add column if not exists service_coverage text
  check (service_coverage in ('on_site', 'in_store'));
