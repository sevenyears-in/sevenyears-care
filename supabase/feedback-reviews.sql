-- Review summaries for customer feedback and publishing on sevenyears.in.
-- The customer's original ratings (answers) and comment are never changed; the summary is kept separately.
alter table public.customer_feedback
  add column if not exists summary               text,
  add column if not exists summary_generated_at  timestamptz,
  add column if not exists public_consent        boolean not null default false,
  add column if not exists display_name          text,
  add column if not exists publication_status    text not null default 'not_eligible',
  add column if not exists published_at          timestamptz,
  add column if not exists status_changed_by     text,
  add column if not exists status_changed_at     timestamptz;

do $$ begin
  alter table public.customer_feedback add constraint customer_feedback_publication_status_check
    check (publication_status in ('pending_review','approved','rejected','published','unpublished','not_eligible'));
exception when duplicate_object then null; end $$;

create index if not exists customer_feedback_published_idx
  on public.customer_feedback (publication_status, published_at desc);

-- Who changed what, when (approve / publish / unpublish / reject / summary regenerated).
create table if not exists public.feedback_review_audit (
  id           bigserial primary key,
  feedback_id  uuid not null references public.customer_feedback(id) on delete cascade,
  action       text not null,
  from_status  text,
  to_status    text,
  changed_by   text not null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists feedback_review_audit_fb_idx on public.feedback_review_audit (feedback_id, created_at desc);
alter table public.feedback_review_audit enable row level security;
