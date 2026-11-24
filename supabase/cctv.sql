-- CCTV (TP-Link VIGI NVR) events: each store's NVR sends "person detected" events with a photo
-- (Settings → Event → Alarm Server on the NVR) to /api/cctv/vigi/<link key>.
-- Photos are kept in a private bucket; photos at an opening / closing punch are kept 90 days,
-- the rest 3 days.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cctv-photos', 'cctv-photos', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

create table if not exists public.cctv_events (
  id           bigserial primary key,
  store        text not null,
  link_id      text not null,
  device_name  text,
  channel      int,
  channel_name text,
  event_type   int,
  sub_type     int,
  event_at     timestamptz not null,
  nvr_time     text,
  received_at  timestamptz not null default now(),
  photo_path   text,
  keep         boolean not null default false,
  raw          jsonb
);
create index if not exists cctv_events_store_at on public.cctv_events (store, event_at);
create index if not exists cctv_events_received on public.cctv_events (received_at);
alter table public.cctv_events enable row level security;

-- Camera check of the person credited with opening / closing (Director / Super Admin):
-- 'ok' = the photo shows that person, 'proxy' = someone else punched for them.
alter table public.store_open_close add column if not exists open_cam text check (open_cam in ('ok','proxy'));
alter table public.store_open_close add column if not exists open_cam_by text;
alter table public.store_open_close add column if not exists open_cam_at timestamptz;
alter table public.store_open_close add column if not exists open_cam_note text;
alter table public.store_open_close add column if not exists close_cam text check (close_cam in ('ok','proxy'));
alter table public.store_open_close add column if not exists close_cam_by text;
alter table public.store_open_close add column if not exists close_cam_at timestamptz;
alter table public.store_open_close add column if not exists close_cam_note text;
