-- Offers wait for the approver (Ajmal Hussain K, 1001) before customers see them.
alter table public.offers add column if not exists approval_status text not null default 'approved';  -- approved | pending | rejected
alter table public.offers add column if not exists approved_by text;
alter table public.offers add column if not exists approved_at timestamptz;
alter table public.offers add column if not exists send_whatsapp boolean not null default false;
