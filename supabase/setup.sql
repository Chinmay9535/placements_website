-- schema.sql + chat.sql + seed.sql in one file. Paste all of it into Supabase → SQL Editor → Run.

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

-- placemenTEA — anonymous chat. Run after schema.sql (safe to re-run).
--
-- Privacy model:
--  * chat_messages (public, realtime) holds only alias + text — never a user id or email.
--  * chat_authors links message → account. No policies, so nobody can read it through the API;
--    only security-definer functions use it (rate limits, bans).
--  * Posting requires a Google login with an @bmsit.in address, checked here in the database.
--    Admins (public.admins) may chat from any account; their messages carry is_admin = true (MOD tag).

-- ───────── who may chat ─────────
create or replace function public.chat_email_ok()
returns boolean
language sql stable
as $$
  select (coalesce(lower(auth.jwt() ->> 'email'), '') like '%@bmsit.in'
          and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google')
      or public.is_admin();
$$;

-- ───────── aliases ─────────
create table if not exists public.chat_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  alias      text not null unique,
  banned     boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.chat_profiles enable row level security;  -- no policies: private

-- ───────── messages ─────────
create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  alias      text not null,
  body       text not null check (char_length(body) between 1 and 500),
  reply_to   bigint references public.chat_messages(id) on delete set null,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.chat_messages add column if not exists is_admin boolean not null default false;
create index if not exists chat_messages_created_idx on public.chat_messages (created_at desc);
alter table public.chat_messages enable row level security;

drop policy if exists "chat is readable by everyone" on public.chat_messages;
create policy "chat is readable by everyone" on public.chat_messages for select using (true);
drop policy if exists "admins delete chat" on public.chat_messages;
create policy "admins delete chat" on public.chat_messages
  for delete to authenticated using (public.is_admin());
-- no insert/update policies: posting only goes through post_chat()

create table if not exists public.chat_authors (
  message_id bigint primary key references public.chat_messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists chat_authors_user_idx on public.chat_authors (user_id, created_at desc);
alter table public.chat_authors enable row level security;  -- no policies: private

-- ───────── functions ─────────
-- Returns the caller's alias, creating a random tea-themed one on first use.
create or replace function public.my_chat_profile()
returns json
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p public.chat_profiles;
  adj text[] := array['Masala','Ginger','Cutting','Elaichi','Kadak','Tulsi','Lemon','Iced','Filter','Sulaimani',
                      'Irani','Matcha','Mint','Honey','Kashmiri','Assam','Nilgiri','Darjeeling','Saffron','Butter',
                      'Jaggery','Smoky','Midnight','Lukewarm','Overbrewed','Sugarfree'];
  noun text[] := array['Intern','Fresher','Recruiter','Coder','Topper','Backbencher','Debugger','Hustler','Dreamer',
                       'Shortlist','Ghost','Offer','Ninja','Analyst','Candidate','Referral','Resume','Aptitude',
                       'Compiler','Placement','Lateral','Stipend','Bond','Onsite'];
  candidate text;
begin
  if uid is null then raise exception 'login required'; end if;
  if not public.chat_email_ok() then raise exception 'only @bmsit.in Google accounts can chat'; end if;

  select * into p from public.chat_profiles where user_id = uid;
  if not found then
    loop
      candidate := adj[1 + floor(random() * array_length(adj, 1))::int] || ' '
                || noun[1 + floor(random() * array_length(noun, 1))::int] || ' '
                || lpad((floor(random() * 1000))::int::text, 3, '0');
      begin
        insert into public.chat_profiles (user_id, alias) values (uid, candidate) returning * into p;
        exit;
      exception when unique_violation then
        -- alias taken (or a parallel call created the profile): retry / re-read
        select * into p from public.chat_profiles where user_id = uid;
        exit when found;
      end;
    end loop;
  end if;
  return json_build_object('alias', p.alias, 'banned', p.banned, 'is_admin', public.is_admin());
end;
$$;

create or replace function public.post_chat(p_body text, p_reply_to bigint default null)
returns public.chat_messages
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  prof public.chat_profiles;
  msg public.chat_messages;
  txt text := btrim(coalesce(p_body, ''));
begin
  if uid is null then raise exception 'login required'; end if;
  if not public.chat_email_ok() then raise exception 'only @bmsit.in Google accounts can chat'; end if;
  perform public.my_chat_profile();
  select * into prof from public.chat_profiles where user_id = uid;
  if prof.banned then raise exception 'you are banned from placemenTEA'; end if;
  if char_length(txt) < 1 then raise exception 'message is empty'; end if;
  if char_length(txt) > 500 then raise exception 'message is too long (500 max)'; end if;
  if (select count(*) from public.chat_authors where user_id = uid and created_at > now() - interval '15 seconds') >= 3 then
    raise exception 'slow down — max 3 messages per 15 seconds';
  end if;
  if (select count(*) from public.chat_authors where user_id = uid and created_at > now() - interval '10 minutes') >= 40 then
    raise exception 'slow down — max 40 messages per 10 minutes';
  end if;
  if p_reply_to is not null and not exists (select 1 from public.chat_messages where id = p_reply_to) then
    p_reply_to := null;
  end if;

  insert into public.chat_messages (alias, body, reply_to, is_admin)
  values (prof.alias, txt, p_reply_to, public.is_admin()) returning * into msg;
  insert into public.chat_authors (message_id, user_id) values (msg.id, uid);
  return msg;
end;
$$;

-- Admin: ban / unban by alias (admins never see emails), optionally wiping their messages.
create or replace function public.admin_set_chat_ban(p_alias text, p_banned boolean, p_purge boolean default false)
returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer := 0; target uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.chat_profiles set banned = p_banned where alias = p_alias returning user_id into target;
  if target is null then raise exception 'no such alias'; end if;
  if p_purge then
    delete from public.chat_messages m using public.chat_authors a
    where a.message_id = m.id and a.user_id = target;
    get diagnostics n = row_count;
  end if;
  return n;
end;
$$;

create or replace function public.admin_banned_aliases()
returns setof text
language sql stable security definer set search_path = public
as $$
  select alias from public.chat_profiles where banned and public.is_admin() order by alias;
$$;

revoke all on function public.my_chat_profile() from public, anon;
revoke all on function public.post_chat(text, bigint) from public, anon;
revoke all on function public.admin_set_chat_ban(text, boolean, boolean) from public, anon;
revoke all on function public.admin_banned_aliases() from public, anon;
grant execute on function public.my_chat_profile() to authenticated;
grant execute on function public.post_chat(text, bigint) to authenticated;
grant execute on function public.admin_set_chat_ban(text, boolean, boolean) to authenticated;
grant execute on function public.admin_banned_aliases() to authenticated;

-- ───────── realtime ─────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- Generated by scripts/seed-from-sheet.mjs — run AFTER schema.sql
insert into public.companies (name, date_raw, role, ctc_raw, intake_raw, rounds, details, position, source, sheet_key) values
  ('PwC', '', '', '', '', '', '', 0, 'sheet', 'pwc#1'),
  ('Flipr', '', '', '10k only internship', '', 'Ghosted', 'multiple rounds of OA', 1, 'sheet', 'flipr#1'),
  ('seqoia', '', 'SDE', '10LPA, 33K internship', '7', '', 'OA - dsa + apti', 2, 'sheet', 'seqoia#1'),
  ('Eklavya', '', 'SDE', '9-12lpa', '', 'Ghosted', '', 3, 'sheet', 'eklavya#1'),
  ('Nielsen', '08/04/2026', 'Data engineering + applied AI', '40k intern, PPO no details', '', '', '', 4, 'sheet', 'nielsen#1'),
  ('IBM', '', 'SDE, ASE', '30k intern, No PPO', '12*', '', 'OA , dsa 2q, interiew for ful stack role', 5, 'sheet', 'ibm#1'),
  ('Epicor', '07/05/2026', 'Prod Dev', '40k // 14lpa', '5', 'took 5 ppl...PBC', 'OA out -> hard dsa..30mins 1 dsa graph q
10 aptitude q in 10mins 
25 q - 5mins quick questions
 Then 5m 5 questions
Cloud, sql, rest api, algorithm, data structures, system design', 6, 'sheet', 'epicor#1'),
  ('pilvo', '19/05/2026', 'Product Operations Engineer Intern', '30k//10lpa', '', 'ML related TAsk', '', 7, 'sheet', 'pilvo#1'),
  ('Catalina Systems', '22/05/2026', '', '10lpa', '', '', '', 8, 'sheet', 'catalina systems#1'),
  ('Everts India', '20/05/2026', '5 roles', '5.5 Lpa', '', 'networking,broadcasting, sql, cpp/java/py,linux', 'OA-> interview - 2 rounds', 9, 'sheet', 'everts india#1'),
  ('Tap Invest', '08/06/2026', '', '25k//10lpa', '', 'Ghosted', '', 10, 'sheet', 'tap invest#1'),
  ('L&T', '', '', '4lpa//bond', '', '', '', 11, 'sheet', 'l&t#1'),
  ('autorabbit - java', '', 'java, hyderabad', '65k', '', '', '', 12, 'sheet', 'autorabbit - java#1'),
  ('ZOPSmart', '07/06/2026', 'SDE', '30k// 10lpa//bond 2years', '', '1-year Internship followed by Full-Time Employment (FTE)', '', 13, 'sheet', 'zopsmart#1'),
  ('yc  ed tech - hyderabad', '', 'all java roles - dsa cohort types', '', '', '', '', 14, 'sheet', 'yc  ed tech - hyderabad#1'),
  ('alfahive', '', 'java', '25k//8lpa', '', '', '', 15, 'sheet', 'alfahive#1'),
  ('varahe', '', 'SDE - Noida', '45k/10lpa', '', 'Ghosted', '', 16, 'sheet', 'varahe#1'),
  ('PRDC', '', 'datanalyst', '', '', '', '', 17, 'sheet', 'prdc#1'),
  ('Talview', '', '', '7lpa', '', '', '', 18, 'sheet', 'talview#1'),
  ('InTimeTech', '', '', '5lpa', '10', '', '', 19, 'sheet', 'intimetech#1'),
  ('Bureau of Indian Standards (BIS)', '', '', '15k', '', 'just a link to apply offcampus', '', 20, 'sheet', 'bureau of indian standards (bis)#1'),
  ('Recruit crm', '', 'sde', '9 lpa', '', 'conducted online OA but no response after that', '', 21, 'sheet', 'recruit crm#1'),
  ('flexton', '', '', '', '', 'Ghosted', '', 22, 'sheet', 'flexton#1'),
  ('infosys - HWI', '', '', '7.5-16lpa', '15*', '', 'OA, then 1 interview', 23, 'sheet', 'infosys - hwi#1'),
  ('eurofins', '', 'Associate Software Engineer
Associate DevOps Engineer
Associate QA Test Engineer', '8lpa', '5', 'Day 1
-> Preplacement Talk on Campus
-> Online Appt & Tech Test
-> Online Coding Test
Day 2
-> Technical Round on Campus
-> Manager Round on Campus', 'Qualification
BE, BTech => CSE, ECE, IT , Bio-Informatics streams, EEE, Mechanical, InfoScience
(Zero backlogs)
Marks Eligibility
70% and CGPA- equivalent of 70%', 24, 'sheet', 'eurofins#1'),
  ('Jaguar', '', '', '36k stipend', '0', '1 YEAR APPRENTICE WITH CONVERSION BASED ON PERFORMANCE.', 'Hiring stopped - 0 intake', 25, 'sheet', 'jaguar#1'),
  ('blackhawk', '', 'sde', '16.5k', '4', '1 year apprenticeship', '', 26, 'sheet', 'blackhawk#1'),
  ('MOXO', '', 'sales', '8lpa', '', '', '', 27, 'sheet', 'moxo#1'),
  ('skylark drones', '', 'full stack dev / vid editor', '', '', 'Ghosted', 'interview at office, but no updates on that', 28, 'sheet', 'skylark drones#1'),
  ('ALE', '21/06/2026', '', '', '', 'Ghosted', '', 29, 'sheet', 'ale#1'),
  ('Ziess', '29/07/2026', '', '', '', 'only aiml', 'Internship Duration: 1 year Only (There is no promise of FTE Conversion)', 30, 'sheet', 'ziess#1'),
  ('IngersolRand', '', 'ai/sap', '20k', '', 'JUST came for aiml branch', '', 31, 'sheet', 'ingersolrand#1'),
  ('Accorian', '', 'Pen Testing', '9lpa', '2', '', 'random mailing for R1...OA - general MCQ, f2f interview, hr round', 32, 'sheet', 'accorian#1'),
  ('nxtWave', '05/08/2026', '', '7-20 lpa', '', '', 'OA - DSA (4Q)+ cs fundamentals followed by tech interview', 33, 'sheet', 'nxtwave#1'),
  ('Infosys', '12/08/2026', '', '7-21lpa', '19', '10- DSE, 9-SP(L1)', 'r1 -  v hard 4 dsa, r2 tech interview - cs fundametals + live dsa coding', 34, 'sheet', 'infosys#1'),
  ('ADM', '', 'data', '', '5', '', 'assignment submission', 35, 'sheet', 'adm#1'),
  ('MOXO', '', 'FDE, sales rep', '30k//7-11lpa', '', '3 rounds', 'r1 GD -  about ai bane, then tech interview', 36, 'sheet', 'moxo#2'),
  ('Siemens Healthcare', '', 'Apprenticeship', '60k//8llpa', '10', 'only cse', 'oa, then 3 rounds interview - resume, cs fundamentals, dsa, hr', 37, 'sheet', 'siemens healthcare#1'),
  ('Siemens Technology,', '', '2m Intern', '10-75k stipend..', '', '5 skills level', '', 38, 'sheet', 'siemens technology,#1'),
  ('Wayfair', '', 'SDE', '75k//26LPA', '', '', '', 39, 'sheet', 'wayfair#1'),
  ('IBM CIO', '', 'sde', '30k//10.75', '20(intern+fte)
 + 4(only intern)', 'IBM -  dsa: matrix traverse
nodejs- debugging 8 test cases

ibm interview:25mins
1-2 dsaQ, resume, group projects, HR', '', 40, 'sheet', 'ibm cio#1'),
  ('The wedding company', '', 'backend / frontend', '15lpa', '0', 'hackerrank contest1.two sum
2.left rotate
3.BST LCA
4.longest common subsequence(DP)
5.Lagest rectangle leetcode hard', 'PLACEMENT STOPPED DUE TO AI MALPRACTICE', 41, 'sheet', 'the wedding company#1'),
  ('Floww', '', 'PM + 4 more', '20k stipend', '5 - (1 for each role)', 'Backend developer is blocked, an API isn''t responding, how do you handle it?
PRD is given, need to deliver by end of year, what''s your approach?
An employee doesn''t complete work within the deadline, what do you do?
Two features need to be built, you can only do one, how do you decide?', '5min interview', 42, 'sheet', 'floww#1'),
  ('Tata Elexis intern', '', '', '3-5lpa', '', '', '', 43, 'sheet', 'tata elexis intern#1'),
  ('Capmob Financial Services LLC', '', 'Data Science Engineering Intern, Cloud and DevOps Engineering Intern', '', '', '', '', 44, 'sheet', 'capmob financial services llc#1'),
  ('Allwave', '', 'sales, PE', '3.5-5 lpa', '', '', '', 45, 'sheet', 'allwave#1'),
  ('Nathaniel School of Music', '', 'non tech roles', '15k/3.12 LPA to 3.84 LPA', '', '', '', 46, 'sheet', 'nathaniel school of music#1'),
  ('Connectivity Solutions (CoSol)', '', 'ai growth/ soln engineer', 'pbc', '', '', '', 47, 'sheet', 'connectivity solutions (cosol)#1'),
  ('Neoveda Technologie', '', 'sde', '15k stipend', '', '', '', 48, 'sheet', 'neoveda technologie#1'),
  ('KoreVity', '', 'soln engineer', '4lpa', '', '', '', 49, 'sheet', 'korevity#1'),
  ('GE Healthcare', '11/09/2026', 'HTCI intern Hiring', '25k intern - pbc', '', '', '', 50, 'sheet', 'ge healthcare#1'),
  ('Polaris', '07/09/2026', 'sde', '8.5lpa', '5', '', '', 51, 'sheet', 'polaris#1'),
  ('West Pharmaceutical', '12/09/2026', 'Graduate Intern', 'gold', '', '1. CSE
2. AI & ML Engineering', 'Aptitude Test
 Group Discussion
 Technical Round
 Manager/Director Round
 HR Round', 52, 'sheet', 'west pharmaceutical#1'),
  ('Siemens', '', 'intern', '15k', '', '', '', 53, 'sheet', 'siemens#1'),
  ('tcs - ninja, digital, prime', '', '', '3.5-9.09L', '', '', '', 54, 'sheet', 'tcs - ninja, digital, prime#1'),
  ('sisa', '', '', 'pbc', '5*', '', '', 55, 'sheet', 'sisa#1'),
  ('Moneyview', '15/09/2026', 'SDE', '40k // 16 L', '5', 'Online Test / Coding / Technical Interview / HR Interview / Managerial Round.', 'random shortlisting for r1 - mails. All rounds ONLINE', 56, 'sheet', 'moneyview#1'),
  ('Zenvexa', '15/09/2026', 'Graduate Engineer Trainee Role', '2-4LPA', '', '', '', 57, 'sheet', 'zenvexa#1'),
  ('First Hire', '17/09/2026', 'Associate Frontend Developer', '8lpa', '', '', '', 58, 'sheet', 'first hire#1'),
  ('MoveinSync', '17/09/2026', 'SDE - Intern (Java Backend)', 'gold -  intern + ppo', '', '', '', 59, 'sheet', 'moveinsync#1'),
  ('Infosys', '18/09/2026', 'Systems Engineer (Trainee)', '3.6 Lpa', 'mass
 hiring', 'Hiring Process - Stages

Pre-placement Talk
Written test
Technical interview
HR interview', '', 60, 'sheet', 'infosys#2'),
  ('LTM', '21/09/2026', 'Graduate Engineer Trainee', '4lpa', '', '', '', 61, 'sheet', 'ltm#1'),
  ('Vinterra', '21/09/2026', '', '7.5', '', 'pbc', '', 62, 'sheet', 'vinterra#1'),
  ('Target', '22/09/2026', '', '₹ 15000 - ₹ 30000 per Month', '', 'Apprenticeship', '', 63, 'sheet', 'target#1'),
  ('ANZ', '23/09/2026', '', '22500  pbc', '', 'Apprentice Hiring', '', 64, 'sheet', 'anz#1'),
  ('Booking Holdings', '23/09/2026', '', '₹ 75000 per Month', '', 'Internship + pbc', 'through hackathon', 65, 'sheet', 'booking holdings#1'),
  ('AIVOA.AI', '28/09/2026', 'Software Testing & QA Intern, AI Product Developer Intern, Management Trainee – AI Solutions & Customer Discovery', 'PBC', '', '', 'https://docs.google.com/document/d/19EXfDlKQAqAlE3g7I3g819aSd8LGcF4yACxS-44a1YY/edit?usp=sharing', 66, 'sheet', 'aivoa.ai#1'),
  ('Joveo', '30/09/2026', 'Software Engineer,New Initiatives,Global Partnership Management', '64K', '', '', '', 67, 'sheet', 'joveo#1'),
  ('Shift', '29/09/2026', 'Business Development Role', 'SILVER', '', '', '', 68, 'sheet', 'shift#1'),
  ('Lowes', '30/09/2026', 'Associate AI Engineer, Associate Software Engineer & Associate Data Engineer', '19LPA', '17', '', '', 69, 'sheet', 'lowes#1'),
  ('Hashdin by Deloitte', '05/10/2026', 'grad trainee', '40k pbc', '', 'pbc', '', 70, 'sheet', 'hashdin by deloitte#1'),
  ('WAISL', '05/10/2026', 'PROJECT MANAGER OFFICE', '15lpa', '', '', '', 71, 'sheet', 'waisl#1'),
  ('FreighAi', '08/10/2026', 'Intern + Performance-Based PPO', '4.2lpa', '', '', '', 72, 'sheet', 'freighai#1'),
  ('TAMPULSE', '12/10/2026', '', '15-20k', '', '', '', 73, 'sheet', 'tampulse#1'),
  ('ZopSmart', '12/10/2026', 'SDET', '30k//8lpa', '', 'Intern + Full-Time(BOND)', '', 74, 'sheet', 'zopsmart#2')
on conflict (sheet_key) do nothing;
