-- Service request photos: private storage bucket + list of photo paths on the request.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-photos', 'service-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
alter table public.service_requests add column if not exists photos text[];
