-- AI photo check of the entrance cameras, and people to watch (lib/camera-ai.ts). Safe to run more than once.
alter table public.cctv_events add column if not exists ai jsonb;
alter table public.cctv_events add column if not exists ai_at timestamptz;
create index if not exists cctv_events_ai_todo on public.cctv_events (event_at) where ai_at is null and photo_path is not null;

create table if not exists public.watch_people (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid,
  name text not null,
  store text not null,
  photo_path text,
  emails text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.watch_people enable row level security;

-- In / out sightings of the day; deleted once the day's e-mail has gone.
create table if not exists public.watch_sightings (
  id bigserial primary key,
  watch_id uuid not null references public.watch_people(id) on delete cascade,
  event_id bigint,
  store text,
  at timestamptz not null,
  direction text,
  photo_path text
);
create index if not exists watch_sightings_person on public.watch_sightings (watch_id, at);
alter table public.watch_sightings enable row level security;

-- Reference photos (private).
insert into storage.buckets (id, name, public) values ('watch-photos', 'watch-photos', false) on conflict (id) do nothing;
