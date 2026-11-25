-- Camera check of store opening / closing (entrance camera vs punches).
-- Opening: the first person the entrance camera saw that morning; an allowed person (SM / ASM /
-- allowed keyholder) must punch within 2 minutes of it. Closing: the last person the camera saw
-- that night must leave within 2 minutes of an allowed person's last punch.
-- Flag: 'ok' | 'early' (entered before an allowed person) | 'late' (someone left after) |
--       'none' (no camera picture in the window).
alter table public.store_open_close add column if not exists open_entry_at timestamptz;
alter table public.store_open_close add column if not exists open_entry_event bigint;
alter table public.store_open_close add column if not exists open_cam_flag text;
alter table public.store_open_close add column if not exists open_cam_flag_note text;
alter table public.store_open_close add column if not exists open_cam_alerted_at timestamptz;
alter table public.store_open_close add column if not exists close_exit_at timestamptz;
alter table public.store_open_close add column if not exists close_exit_event bigint;
alter table public.store_open_close add column if not exists close_cam_flag text;
alter table public.store_open_close add column if not exists close_cam_flag_note text;
alter table public.store_open_close add column if not exists close_cam_alerted_at timestamptz;
