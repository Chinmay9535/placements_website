-- BMSIT Placements '27 — Supabase schema
-- Run this whole file once in Supabase → SQL Editor, then run seed.sql.
-- Finally add yourself as an admin (bottom of this file).

create extension if not exists pgcrypto;

-- ───────────────────────── admins ─────────────────────────
create table if not exists public.admins (
  email text primary key
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

drop policy if exists "admins can see themselves" on public.admins;
create policy "admins can see themselves" on public.admins
  for select to authenticated using (lower(email) = lower(auth.jwt() ->> 'email'));

-- ───────────────────────── companies ─────────────────────────
-- Raw text is stored exactly as students write it in the sheet; the site
-- parses CTC / stipend / tags at render time so nothing is "cleaned away".
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  date_raw    text not null default '',
  role        text not null default '',
  ctc_raw     text not null default '',
  intake_raw  text not null default '',
  rounds      text not null default '',
  details     text not null default '',
  position    double precision not null default extract(epoch from now()),
  source      text not null default 'manual' check (source in ('sheet', 'manual')),
  -- For sheet rows: lower(name) + '#' + nth occurrence of that name in the sheet.
  -- Lets a re-sync update rows in place so their experiences survive.
  sheet_key   text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists companies_position_idx on public.companies (position desc);
alter table public.companies enable row level security;

drop policy if exists "companies are public" on public.companies;
create policy "companies are public" on public.companies for select using (true);
drop policy if exists "admins write companies" on public.companies;
create policy "admins write companies" on public.companies
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists companies_touch on public.companies;
create trigger companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();

-- ───────────────────────── experiences ─────────────────────────
-- Anonymous, unfiltered notes from students about a drive.
create table if not exists public.experiences (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  handle      text not null default '' check (char_length(handle) <= 40),
  outcome     text not null default 'info'
              check (outcome in ('selected', 'rejected', 'ghosted', 'in-process', 'info')),
  body        text not null check (char_length(body) between 10 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists experiences_company_idx on public.experiences (company_id, created_at desc);
alter table public.experiences enable row level security;

drop policy if exists "experiences are public" on public.experiences;
create policy "experiences are public" on public.experiences for select using (true);
drop policy if exists "anyone can post an experience" on public.experiences;
create policy "anyone can post an experience" on public.experiences
  for insert to anon, authenticated with check (true);
drop policy if exists "admins moderate experiences" on public.experiences;
create policy "admins moderate experiences" on public.experiences
  for delete to authenticated using (public.is_admin());

-- ───────────────────────── submissions ─────────────────────────
-- "A new company just came" tips from students; admins review before publishing.
create table if not exists public.submissions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  date_raw    text not null default '' check (char_length(date_raw) <= 40),
  role        text not null default '' check (char_length(role) <= 300),
  ctc_raw     text not null default '' check (char_length(ctc_raw) <= 200),
  intake_raw  text not null default '' check (char_length(intake_raw) <= 60),
  details     text not null default '' check (char_length(details) <= 3000),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'dismissed')),
  created_at  timestamptz not null default now()
);
alter table public.submissions enable row level security;

drop policy if exists "anyone can submit" on public.submissions;
create policy "anyone can submit" on public.submissions
  for insert to anon, authenticated with check (status = 'pending');
drop policy if exists "admins manage submissions" on public.submissions;
create policy "admins manage submissions" on public.submissions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ───────────────────────── sheet sync ─────────────────────────
-- Upserts the Google Sheet rows by sheet_key: changed rows are updated in place
-- (experiences kept), new rows inserted, rows gone from the sheet deleted.
-- Rows added by hand in the admin panel (source = 'manual') are never touched
-- and always sort above sheet rows (their position is an epoch timestamp).
create or replace function public.sync_sheet(rows jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  create temp table incoming on commit drop as
  select x.*,
         lower(trim(x.name)) || '#' || row_number() over (partition by lower(trim(x.name)) order by x.pos) as k
  from (
    select r->>'name' as name, coalesce(r->>'date_raw', '') as date_raw, coalesce(r->>'role', '') as role,
           coalesce(r->>'ctc_raw', '') as ctc_raw, coalesce(r->>'intake_raw', '') as intake_raw,
           coalesce(r->>'rounds', '') as rounds, coalesce(r->>'details', '') as details,
           (r->>'position')::double precision as pos
    from jsonb_array_elements(rows) r
    where coalesce(trim(r->>'name'), '') <> ''
  ) x;

  delete from public.companies c
  where c.source = 'sheet' and not exists (select 1 from incoming i where i.k = c.sheet_key);

  update public.companies c
  set name = i.name, date_raw = i.date_raw, role = i.role, ctc_raw = i.ctc_raw,
      intake_raw = i.intake_raw, rounds = i.rounds, details = i.details, position = i.pos
  from incoming i
  where c.sheet_key = i.k and c.source = 'sheet';

  insert into public.companies (name, date_raw, role, ctc_raw, intake_raw, rounds, details, position, source, sheet_key)
  select i.name, i.date_raw, i.role, i.ctc_raw, i.intake_raw, i.rounds, i.details, i.pos, 'sheet', i.k
  from incoming i
  where not exists (select 1 from public.companies c where c.sheet_key = i.k);

  select count(*) into n from incoming;
  return n;
end;
$$;
revoke all on function public.sync_sheet(jsonb) from public, anon;
grant execute on function public.sync_sheet(jsonb) to authenticated;

-- ───────────────────────── make yourself admin ─────────────────────────
-- 1. Supabase → Authentication → Users → "Add user" (email + password, auto-confirm)
-- 2. Then run (with your email):
-- insert into public.admins (email) values ('you@example.com');
