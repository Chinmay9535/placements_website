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
