-- Patch 004: company channels, reactions, reports, anti-doxx + profanity filter,
--            and applied/shortlisted/offer counts. Safe to run more than once.
-- Needs: schema.sql (companies, upcoming_drives, is_admin), chat.sql (+ patch 002).

-- ───────── helpers ─────────
-- Same rule as slug() in src/lib/slug.ts — keep them in sync.
create or replace function public.chat_slug(t text)
returns text language sql immutable as $$
  select left(trim(both '-' from regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '-', 'g')), 40);
$$;

-- Returns what kind of personal info a text contains, or null if it's clean.
create or replace function public.doxx_reason(txt text)
returns text language plpgsql immutable as $$
declare t text := regexp_replace(coalesce(txt, ''), 'https?://\S+', ' ', 'gi');
begin
  if t ~* '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}' then return 'email addresses'; end if;
  if t ~* '\m[1-4][a-z]{2}[0-9]{2}[a-z]{2,3}[0-9]{3}\M' then return 'USNs / roll numbers'; end if;
  if regexp_replace(t, '[\s().-]', '', 'g') ~ '(^|[^0-9])(\+?91)?[6-9][0-9]{9}([^0-9]|$)' then return 'phone numbers'; end if;
  return null;
end;
$$;

-- Masks common English / Hindi / Kannada profanity: "fuck" → "f***".
create or replace function public.mask_profanity(txt text)
returns text language plpgsql immutable as $$
declare
  pat constant text := '\m(f+u+c+k\w*|motherf\w*|sh+i+t+\w*|bitch\w*|bastard\w*|asshole\w*|dick|dickhead\w*|cunt\w*|slut\w*|whore\w*|retard\w*|fag\w*|nigg\w*|madarchod\w*|maderchod\w*|bhenchod\w*|behenchod\w*|bc|mc|bsdk|chutiy\w*|chutia\w*|gandu\w*|bhosd\w*|randi\w*|lavde\w*|lawde\w*|lund|loda|lodu\w*|harami\w*|sule|soole\w*|sulemag\w*|bolimag\w*|tunne)\M';
  m text;
begin
  if txt is null then return null; end if;
  for m in select distinct lower((regexp_matches(txt, pat, 'gi'))[1]) loop
    txt := regexp_replace(txt, '\m' || m || '\M', left(m, 1) || repeat('*', greatest(length(m) - 1, 1)), 'gi');
  end loop;
  return txt;
end;
$$;

-- ───────── chat: channels, reactions, hidden-after-reports ─────────
alter table public.chat_messages add column if not exists channel text not null default 'general';
alter table public.chat_messages add column if not exists reactions jsonb not null default '{}'::jsonb;
alter table public.chat_messages add column if not exists hidden boolean not null default false;
do $$ begin
  alter table public.chat_messages add constraint chat_messages_channel_format check (channel ~ '^[a-z0-9-]{1,40}$');
exception when duplicate_object then null; end $$;
create index if not exists chat_messages_channel_idx on public.chat_messages (channel, id desc);

create table if not exists public.chat_reactions (
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  emoji      text   not null check (emoji in ('👍', '💀', '☕')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.chat_reactions enable row level security;  -- private: no policies

create table if not exists public.chat_reports (
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  reason     text   not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.chat_reports enable row level security;  -- private: no policies

-- A channel is "general" or the slug of a company / upcoming drive.
create or replace function public.chat_channel_ok(p_channel text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_channel = 'general'
      or exists (select 1 from public.companies where public.chat_slug(name) = p_channel)
      or exists (select 1 from public.upcoming_drives where public.chat_slug(name) = p_channel);
$$;

drop function if exists public.post_chat(text, bigint);
create or replace function public.post_chat(p_body text, p_reply_to bigint default null, p_channel text default 'general')
returns public.chat_messages
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  prof public.chat_profiles;
  msg public.chat_messages;
  txt text := btrim(coalesce(p_body, ''));
  ch text := coalesce(nullif(p_channel, ''), 'general');
  why text;
begin
  if uid is null then raise exception 'login required'; end if;
  if not public.chat_email_ok() then raise exception 'only @bmsit.in Google accounts can chat'; end if;
  perform public.my_chat_profile();
  select * into prof from public.chat_profiles where user_id = uid;
  if prof.banned then raise exception 'you are banned from placemenTEA'; end if;
  if char_length(txt) < 1 then raise exception 'message is empty'; end if;
  if char_length(txt) > 500 then raise exception 'message is too long (500 max)'; end if;
  if not public.chat_channel_ok(ch) then raise exception 'unknown channel'; end if;
  why := public.doxx_reason(txt);
  if why is not null then
    raise exception 'blocked: no % in placemenTEA — keep everyone anonymous', why;
  end if;
  if (select count(*) from public.chat_authors where user_id = uid and created_at > now() - interval '15 seconds') >= 3 then
    raise exception 'slow down — max 3 messages per 15 seconds';
  end if;
  if (select count(*) from public.chat_authors where user_id = uid and created_at > now() - interval '10 minutes') >= 40 then
    raise exception 'slow down — max 40 messages per 10 minutes';
  end if;
  if p_reply_to is not null and not exists (select 1 from public.chat_messages where id = p_reply_to and channel = ch) then
    p_reply_to := null;
  end if;

  insert into public.chat_messages (alias, body, reply_to, is_admin, channel)
  values (prof.alias, public.mask_profanity(txt), p_reply_to, public.is_admin(), ch) returning * into msg;
  insert into public.chat_authors (message_id, user_id) values (msg.id, uid);
  return msg;
end;
$$;

-- Channels with recent activity, for the channel list.
create or replace function public.chat_channels()
returns table (channel text, messages bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select channel, count(*), max(created_at)
  from public.chat_messages
  where created_at > now() - interval '14 days' and not hidden
  group by channel
  order by max(created_at) desc
  limit 50;
$$;

create or replace function public.toggle_reaction(p_message bigint, p_emoji text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid(); r jsonb;
begin
  if uid is null then raise exception 'login required'; end if;
  if not public.chat_email_ok() then raise exception 'only @bmsit.in Google accounts can chat'; end if;
  if exists (select 1 from public.chat_profiles where user_id = uid and banned) then raise exception 'you are banned from placemenTEA'; end if;
  if p_emoji not in ('👍', '💀', '☕') then raise exception 'unknown reaction'; end if;
  if not exists (select 1 from public.chat_messages where id = p_message) then raise exception 'message not found'; end if;

  if exists (select 1 from public.chat_reactions where message_id = p_message and user_id = uid and emoji = p_emoji) then
    delete from public.chat_reactions where message_id = p_message and user_id = uid and emoji = p_emoji;
  else
    insert into public.chat_reactions (message_id, user_id, emoji) values (p_message, uid, p_emoji);
  end if;

  update public.chat_messages
  set reactions = coalesce((select jsonb_object_agg(emoji, n)
                            from (select emoji, count(*) as n from public.chat_reactions
                                  where message_id = p_message group by emoji) x), '{}'::jsonb)
  where id = p_message
  returning reactions into r;
  return r;
end;
$$;

create or replace function public.my_reactions(p_ids bigint[])
returns table (message_id bigint, emoji text)
language sql stable security definer set search_path = public as $$
  select message_id, emoji from public.chat_reactions
  where user_id = auth.uid() and message_id = any(p_ids);
$$;

-- 3 distinct reports hide a message until a mod reviews it.
create or replace function public.report_chat(p_message bigint, p_reason text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login required'; end if;
  if not public.chat_email_ok() then raise exception 'only @bmsit.in Google accounts can report'; end if;
  insert into public.chat_reports (message_id, user_id, reason)
  values (p_message, uid, left(coalesce(p_reason, ''), 200))
  on conflict do nothing;
  if (select count(*) from public.chat_reports where message_id = p_message) >= 3 then
    update public.chat_messages set hidden = true where id = p_message;
  end if;
end;
$$;

create or replace function public.admin_chat_reports()
returns table (message_id bigint, channel text, alias text, body text, hidden boolean, reports bigint, reasons text[], last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.channel, m.alias, m.body, m.hidden, count(r.*),
         array_remove(array_agg(nullif(r.reason, '')), null), max(r.created_at)
  from public.chat_reports r join public.chat_messages m on m.id = r.message_id
  where public.is_admin()
  group by m.id
  order by max(r.created_at) desc;
$$;

-- p_action: 'dismiss' (clear reports, unhide) or 'delete' (remove the message)
create or replace function public.admin_resolve_report(p_message bigint, p_action text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_action = 'delete' then
    delete from public.chat_messages where id = p_message;
  elsif p_action = 'dismiss' then
    delete from public.chat_reports where message_id = p_message;
    update public.chat_messages set hidden = false where id = p_message;
  else
    raise exception 'unknown action';
  end if;
end;
$$;

-- ───────── experiences: same anti-doxx + profanity rules ─────────
create or replace function public.experiences_guard()
returns trigger language plpgsql as $$
declare why text := coalesce(public.doxx_reason(new.body), public.doxx_reason(new.handle));
begin
  if why is not null then
    raise exception 'blocked: no % in experiences — keep everyone anonymous', why;
  end if;
  new.body := public.mask_profanity(new.body);
  new.handle := public.mask_profanity(new.handle);
  return new;
end;
$$;
drop trigger if exists experiences_guard on public.experiences;
create trigger experiences_guard before insert on public.experiences
  for each row execute function public.experiences_guard();

-- ───────── applied → shortlisted → offer ─────────
create table if not exists public.drive_progress (
  user_id    uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  stage      text not null check (stage in ('applied', 'shortlisted', 'offer')),
  updated_at timestamptz not null default now(),
  primary key (user_id, company_id)
);
create index if not exists drive_progress_company_idx on public.drive_progress (company_id);
alter table public.drive_progress enable row level security;  -- private: no policies

-- p_stage = null or '' clears your status for that company.
create or replace function public.set_drive_progress(p_company uuid, p_stage text)
returns void
language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login required'; end if;
  if not public.chat_email_ok() then raise exception 'only @bmsit.in Google accounts can add their status'; end if;
  if coalesce(p_stage, '') = '' then
    delete from public.drive_progress where user_id = uid and company_id = p_company;
    return;
  end if;
  if p_stage not in ('applied', 'shortlisted', 'offer') then raise exception 'unknown stage'; end if;
  insert into public.drive_progress (user_id, company_id, stage) values (uid, p_company, p_stage)
  on conflict (user_id, company_id) do update set stage = excluded.stage, updated_at = now();
end;
$$;

-- Public totals only. "applied" counts everyone at any stage.
create or replace function public.drive_progress_counts()
returns table (company_id uuid, applied bigint, shortlisted bigint, offers bigint)
language sql stable security definer set search_path = public as $$
  select company_id, count(*),
         count(*) filter (where stage in ('shortlisted', 'offer')),
         count(*) filter (where stage = 'offer')
  from public.drive_progress group by company_id;
$$;

create or replace function public.my_drive_progress()
returns table (company_id uuid, stage text)
language sql stable security definer set search_path = public as $$
  select company_id, stage from public.drive_progress where user_id = auth.uid();
$$;

-- ───────── grants ─────────
revoke all on function public.post_chat(text, bigint, text) from public, anon;
revoke all on function public.toggle_reaction(bigint, text) from public, anon;
revoke all on function public.my_reactions(bigint[]) from public, anon;
revoke all on function public.report_chat(bigint, text) from public, anon;
revoke all on function public.admin_chat_reports() from public, anon;
revoke all on function public.admin_resolve_report(bigint, text) from public, anon;
revoke all on function public.set_drive_progress(uuid, text) from public, anon;
revoke all on function public.my_drive_progress() from public, anon;
grant execute on function public.post_chat(text, bigint, text) to authenticated;
grant execute on function public.toggle_reaction(bigint, text) to authenticated;
grant execute on function public.my_reactions(bigint[]) to authenticated;
grant execute on function public.report_chat(bigint, text) to authenticated;
grant execute on function public.admin_chat_reports() to authenticated;
grant execute on function public.admin_resolve_report(bigint, text) to authenticated;
grant execute on function public.set_drive_progress(uuid, text) to authenticated;
grant execute on function public.my_drive_progress() to authenticated;
grant execute on function public.chat_channels() to anon, authenticated;
grant execute on function public.drive_progress_counts() to anon, authenticated;
