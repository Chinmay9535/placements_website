-- Patch 003: upcoming drives (announced but not yet happened). Safe to run more than once.
-- Public can read; only admins (public.admins) can add / edit / delete.

create table if not exists public.upcoming_drives (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  role        text not null default '' check (char_length(role) <= 300),
  ctc_raw     text not null default '' check (char_length(ctc_raw) <= 200),
  eligibility text not null default '' check (char_length(eligibility) <= 1000),
  drive_date  date,                 -- day of the test / drive
  deadline    timestamptz,          -- registration closes
  apply_link  text not null default '' check (apply_link = '' or apply_link ~* '^https?://'),
  notes       text not null default '' check (char_length(notes) <= 3000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists upcoming_drives_date_idx on public.upcoming_drives (drive_date, deadline);
alter table public.upcoming_drives enable row level security;

drop policy if exists "upcoming is public" on public.upcoming_drives;
create policy "upcoming is public" on public.upcoming_drives for select using (true);
drop policy if exists "admins write upcoming" on public.upcoming_drives;
create policy "admins write upcoming" on public.upcoming_drives
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists upcoming_touch on public.upcoming_drives;
create trigger upcoming_touch before update on public.upcoming_drives
  for each row execute function public.touch_updated_at();
