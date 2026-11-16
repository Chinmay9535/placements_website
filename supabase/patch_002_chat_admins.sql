-- Patch 002: admins can chat from any account; admin messages get a MOD tag.
-- Safe to run more than once. (Already included in chat.sql / setup.sql for fresh installs.)

alter table public.chat_messages add column if not exists is_admin boolean not null default false;

create or replace function public.chat_email_ok()
returns boolean
language sql stable
as $$
  select (coalesce(lower(auth.jwt() ->> 'email'), '') like '%@bmsit.in'
          and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google')
      or public.is_admin();
$$;

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
