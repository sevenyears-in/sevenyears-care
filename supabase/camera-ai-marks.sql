-- Walk-in photos marked by a manager ("not a customer — staff" / "this is a customer").
-- The camera count follows the mark, and the AI learns from the marked photos (lib/camera-ai.ts).
-- A copy of each marked photo is kept in the private bucket camera-ai-examples (CCTV photos are deleted after some days).
-- Safe to run more than once.
create table if not exists public.camera_ai_marks (
  event_id bigint primary key,
  store text not null,
  verdict text not null check (verdict in ('staff', 'customer')),
  note text,
  example_path text,
  by_name text,
  created_at timestamptz not null default now()
);
create index if not exists camera_ai_marks_store on public.camera_ai_marks (store, created_at desc);
alter table public.camera_ai_marks enable row level security;

insert into storage.buckets (id, name, public) values ('camera-ai-examples', 'camera-ai-examples', false) on conflict (id) do nothing;
