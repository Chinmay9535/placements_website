import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CHAT_DOMAIN, supabase } from '../lib/supabase';
import { errText, signInWithCollegeGoogle } from '../lib/auth';
import { doxxReason } from '../lib/filters';
import { slug } from '../lib/slug';
import { Icon } from './ui';

type Msg = {
  id: number;
  alias: string;
  body: string;
  reply_to: number | null;
  is_admin?: boolean;
  channel?: string;
  reactions?: Record<string, number>;
  hidden?: boolean;
  created_at: string;
};
type Profile = { alias: string; banned: boolean; is_admin?: boolean };

const PAGE = 60;
const EMOJIS = ['👍', '💀', '☕'] as const;
const AVATAR_BG = ['#e3e2f7', '#e2e6cf', '#f2cfcf', '#d4ecf7', '#c7c4ee', '#c9d0a6', '#e3a3a6', '#b9c9d4'];
const SEEN_KEY = 'tea:seen';

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const initials = (alias: string) => alias.split(' ').slice(0, 2).map((w) => w[0]).join('');
const ModTag = () => <span className="mod-tag" title="Moderator">MOD</span>;

/** Open a company channel from anywhere on the page (e.g. "Discuss in #wayfair"). */
export function openTeaChannel(companyName: string) {
  window.dispatchEvent(new CustomEvent('tea:open', { detail: slug(companyName) }));
  document.getElementById('tea')?.scrollIntoView({ behavior: 'smooth' });
}

function clock(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const t = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return today ? t : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${t}`;
}

function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/\S+)/g).map((p, i) =>
        /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener nofollow">{p}</a> : <span key={i}>{p}</span>
      )}
    </>
  );
}

function loadSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
  } catch {
    return {};
  }
}

export function Tea({ session, companyNames, upcomingNames }: { session: Session | null; companyNames: string[]; upcomingNames: string[] }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notAllowed, setNotAllowed] = useState(false);
  const [channel, setChannel] = useState('general');
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [mine, setMine] = useState<Set<string>>(new Set()); // `${id}:${emoji}` I reacted with
  const [active, setActive] = useState<{ channel: string; last: number }[]>([]);
  const [opened, setOpened] = useState<string[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [picker, setPicker] = useState(false);
  const [pickQ, setPickQ] = useState('');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const channelRef = useRef(channel);
  channelRef.current = channel;

  // slug → display name
  const names = useMemo(() => {
    const m = new Map<string, string>([['general', 'general']]);
    for (const n of [...companyNames, ...upcomingNames]) if (!m.has(slug(n))) m.set(slug(n), n.trim());
    return m;
  }, [companyNames, upcomingNames]);

  // channel tabs: general, opened ones, upcoming drives, recently active
  const tabs = useMemo(() => {
    const out: string[] = ['general'];
    const add = (s: string) => s && names.has(s) && !out.includes(s) && out.push(s);
    opened.forEach(add);
    upcomingNames.map(slug).forEach(add);
    active.map((a) => a.channel).forEach(add);
    if (!out.includes(channel)) out.splice(1, 0, channel);
    return out.slice(0, 14);
  }, [opened, upcomingNames, active, channel, names]);

  // ── profile ──
  useEffect(() => {
    setNotAllowed(false);
    if (!supabase || !session) return setProfile(null);
    supabase.rpc('my_chat_profile').then(({ data, error }) => {
      if (error) {
        setProfile(null);
        if (/bmsit\.in/i.test(error.message)) setNotAllowed(true);
        else setErr(errText(error));
      } else {
        setErr('');
        setProfile(data as Profile);
      }
    });
  }, [session]);

  // ── active channels ──
  const loadActive = useCallback(() => {
    if (!supabase) return;
    supabase.rpc('chat_channels').then(({ data }) => {
      const rows = ((data ?? []) as { channel: string; last_at: string }[]).map((r) => ({ channel: r.channel, last: Date.parse(r.last_at) }));
      setActive(rows);
      const seen = loadSeen();
      setUnread((u) => {
        const next = { ...u };
        for (const r of rows) if (r.channel !== channelRef.current && r.last > (seen[r.channel] ?? 0)) next[r.channel] = Math.max(next[r.channel] ?? 0, 1);
        return next;
      });
    });
  }, []);
  useEffect(loadActive, [loadActive]);

  // ── "Discuss in #company" from elsewhere on the page ──
  useEffect(() => {
    const onOpen = (e: Event) => {
      const s = (e as CustomEvent<string>).detail;
      if (!s) return;
      setOpened((o) => (o.includes(s) ? o : [s, ...o]));
      setChannel(s);
    };
    window.addEventListener('tea:open', onOpen);
    return () => window.removeEventListener('tea:open', onOpen);
  }, []);

  const markSeen = (ch: string) => {
    try {
      const seen = loadSeen();
      seen[ch] = Date.now();
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch {
      /* ignore */
    }
    setUnread((u) => ({ ...u, [ch]: 0 }));
  };

  // ── messages for the current channel ──
  useEffect(() => {
    if (!supabase) return;
    setMsgs(null);
    setReplyTo(null);
    stick.current = true;
    markSeen(channel);
    supabase
      .from('chat_messages')
      .select('*')
      .eq('channel', channel)
      .order('id', { ascending: false })
      .limit(PAGE)
      .then(({ data, error }) => {
        // before patch 004 there is no channel column: fall back to everything in "general"
        if (error && channel === 'general') {
          supabase!.from('chat_messages').select('*').order('id', { ascending: false }).limit(PAGE).then(({ data: d2 }) => {
            setMsgs(((d2 ?? []) as Msg[]).reverse());
          });
          return;
        }
        const rows = ((data ?? []) as Msg[]).reverse();
        setMsgs(rows);
        setHasOlder(rows.length === PAGE);
      });
  }, [channel]);

  // which reactions are mine (for highlighted pills)
  useEffect(() => {
    if (!supabase || !profile || !msgs?.length) return;
    supabase.rpc('my_reactions', { p_ids: msgs.map((m) => m.id) }).then(({ data }) => {
      setMine(new Set(((data ?? []) as { message_id: number; emoji: string }[]).map((r) => `${r.message_id}:${r.emoji}`)));
    });
    // only when the loaded set changes size (new channel / older page), not on every reaction
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, msgs?.length, channel]);

  // ── realtime ──
  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    const ch = sb
      .channel('placementea', { config: { presence: { key: crypto.randomUUID?.() ?? String(Math.random()) } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (p) => {
        const m = p.new as Msg;
        const c = m.channel ?? 'general';
        if (c === channelRef.current) {
          setMsgs((cur) => (cur && !cur.some((x) => x.id === m.id) ? [...cur, m] : cur));
          markSeen(c);
        } else {
          setUnread((u) => ({ ...u, [c]: (u[c] ?? 0) + 1 }));
          setActive((a) => [{ channel: c, last: Date.now() }, ...a.filter((x) => x.channel !== c)]);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, (p) => {
        const m = p.new as Msg;
        setMsgs((cur) => cur?.map((x) => (x.id === m.id ? { ...x, ...m } : x)) ?? cur);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages' }, (p) => {
        const id = (p.old as { id?: number }).id;
        setMsgs((cur) => cur?.filter((x) => x.id !== id) ?? cur);
      })
      .on('presence', { event: 'sync' }, () => setOnline(Object.keys(ch.presenceState()).length))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') ch.track({ at: Date.now() });
      });
    return () => {
      sb.removeChannel(ch);
    };
  }, []);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, profile]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadOlder = useCallback(async () => {
    if (!supabase || !msgs?.length) return;
    const el = listRef.current;
    const before = el?.scrollHeight ?? 0;
    const { data } = await supabase.from('chat_messages').select('*').eq('channel', channel).lt('id', msgs[0].id).order('id', { ascending: false }).limit(PAGE);
    const older = ((data ?? []) as Msg[]).reverse();
    stick.current = false;
    setMsgs((cur) => [...older, ...(cur ?? [])]);
    setHasOlder(older.length === PAGE);
    requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight - before));
  }, [msgs, channel]);

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(''), 2500);
  };

  async function signIn() {
    try {
      await signInWithCollegeGoogle('tea');
    } catch (e) {
      setErr(errText(e));
    }
  }

  const warn = doxxReason(text);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!supabase || busy) return;
    const body = text.trim();
    if (!body) return;
    if (warn) return setErr(`Remove ${warn} first. placemenTEA is anonymous.`);
    setBusy(true);
    setErr('');
    const { data, error } = await supabase.rpc('post_chat', { p_body: body, p_reply_to: replyTo?.id ?? null, p_channel: channel });
    setBusy(false);
    if (error) return setErr(errText(error));
    const m = data as Msg;
    stick.current = true;
    setMsgs((cur) => (cur && !cur.some((x) => x.id === m.id) ? [...cur, m] : cur));
    setText('');
    setReplyTo(null);
    if (!active.some((a) => a.channel === channel)) loadActive();
    inputRef.current?.focus();
  }

  async function react(m: Msg, emoji: string) {
    if (!supabase || !profile) return flash('Sign in to react');
    const key = `${m.id}:${emoji}`;
    const had = mine.has(key);
    // optimistic
    setMine((s) => {
      const n = new Set(s);
      had ? n.delete(key) : n.add(key);
      return n;
    });
    const { data, error } = await supabase.rpc('toggle_reaction', { p_message: m.id, p_emoji: emoji });
    if (error) {
      setMine((s) => {
        const n = new Set(s);
        had ? n.add(key) : n.delete(key);
        return n;
      });
      return flash(errText(error));
    }
    setMsgs((cur) => cur?.map((x) => (x.id === m.id ? { ...x, reactions: data as Record<string, number> } : x)) ?? cur);
  }

  async function report(m: Msg) {
    if (!supabase || !profile) return flash('Sign in to report');
    const reason = window.prompt(`Report this message from ${m.alias}?\nOptional: why? (spam, doxxing, abuse…)`, '');
    if (reason === null) return;
    const { error } = await supabase.rpc('report_chat', { p_message: m.id, p_reason: reason });
    flash(error ? errText(error) : 'Reported. Mods will take a look. Thanks!');
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const byId = new Map((msgs ?? []).map((m) => [m.id, m]));
  const wrongAccount = Boolean(session && notAllowed);
  const canChat = Boolean(profile && !profile.banned);
  const label = (s: string) => names.get(s) ?? s;
  const openPicked = (s: string) => {
    setOpened((o) => (o.includes(s) ? o : [s, ...o]));
    setChannel(s);
    setPicker(false);
    setPickQ('');
  };
  const pickList = useMemo(() => {
    const q = pickQ.trim().toLowerCase();
    return [...names.entries()].filter(([s, n]) => s !== 'general' && (!q || n.toLowerCase().includes(q))).slice(0, 8);
  }, [names, pickQ]);

  return (
    <div className="tea-grid">
      <aside className="tea-side">
        <div className="tea-cup" aria-hidden>
          <svg width="56" height="56" viewBox="0 0 64 64">
            <path className="steam s1" d="M24 18c-3-4 3-6 0-11" />
            <path className="steam s2" d="M32 18c-3-4 3-6 0-11" />
            <path className="steam s3" d="M40 18c-3-4 3-6 0-11" />
            <path d="M12 26h40v8c0 11-9 20-20 20S12 45 12 34z" fill="#e3e2f7" />
            <path d="M52 30h3a6 6 0 010 12h-4" fill="none" stroke="#e3e2f7" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
        <div className="tea-online"><span className="dot" />{online > 0 ? `${online} sipping now` : 'connecting…'}</div>

        {!supabase ? (
          <p className="tea-note">Chat turns on once the database is connected.</p>
        ) : canChat ? (
          <div className="tea-me">
            <div className="k">You're chatting as</div>
            <div className="tea-alias-pill">
              <span className="av" style={{ background: AVATAR_BG[Math.abs(hash(profile!.alias)) % AVATAR_BG.length] }}>{initials(profile!.alias)}</span>
              {profile!.alias}
              {profile!.is_admin && <ModTag />}
            </div>
            <button className="tea-link" onClick={() => supabase!.auth.signOut()}>Sign out</button>
          </div>
        ) : profile?.banned ? (
          <div className="tea-me">
            <p className="tea-note">This account was banned from placemenTEA by a moderator. You can still read.</p>
            <button className="tea-link" onClick={() => supabase!.auth.signOut()}>Sign out</button>
          </div>
        ) : wrongAccount ? (
          <div className="tea-me">
            <p className="tea-note">
              You're signed in as <b>{session!.user.email}</b>. Only <b>@{CHAT_DOMAIN}</b> Google accounts can chat.
            </p>
            <button className="btn light" onClick={async () => { await supabase!.auth.signOut(); signIn(); }}>Switch account</button>
          </div>
        ) : (
          <div className="tea-me">
            <button className="btn light google" onClick={signIn}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
              </svg>
              Sign in with college Google
            </button>
            <p className="tea-note">@{CHAT_DOMAIN} accounts only. You get a random alias. Reading needs no login.</p>
          </div>
        )}

        <ul className="tea-rules">
          <li>Spill the tea, not people's names: no students, recruiters or faculty.</li>
          <li>Emails, phone numbers and USNs are blocked automatically. Swear words get masked.</li>
          <li>Report anything sketchy. 3 reports hide a message until a mod checks it.</li>
          <li>Others only ever see your alias. The site never shows who's behind one, but the project owner could technically look it up in the database, so don't post anything you'd regret.</li>
        </ul>
      </aside>

      <div className="tea-chat">
        <div className="tea-channels" role="tablist" aria-label="Channels">
          {tabs.map((s) => (
            <button key={s} role="tab" aria-selected={s === channel} className={`tea-ch${s === channel ? ' on' : ''}`} onClick={() => setChannel(s)}>
              #{s === 'general' ? 'general' : label(s).toLowerCase()}
              {s !== channel && (unread[s] ?? 0) > 0 && <span className="tea-unread" aria-label="new messages" />}
            </button>
          ))}
          <button className="tea-ch add" onClick={() => setPicker((v) => !v)} aria-expanded={picker} aria-label="Open a company channel">+ company</button>
        </div>

        {picker && (
          <div className="tea-pick-pop" role="dialog" aria-label="Open a company channel">
            <input
              autoFocus
              value={pickQ}
              onChange={(e) => setPickQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setPicker(false);
                if (e.key === 'Enter' && pickList[0]) openPicked(pickList[0][0]);
              }}
              placeholder="Search company…"
              aria-label="Search company channel"
            />
            {pickList.map(([s, n]) => (
              <button key={s} onClick={() => openPicked(s)}>#{n.toLowerCase()}</button>
            ))}
            {pickList.length === 0 && <span className="tea-note" style={{ padding: '6px 10px' }}>No match</span>}
          </div>
        )}

        <div className="tea-list" ref={listRef} onScroll={onScroll} onMouseDown={() => setPicker(false)} aria-live="polite" aria-label={`#${label(channel)} messages`}>
          {hasOlder && (
            <div className="tea-older"><button className="chip" onClick={loadOlder}>Load older messages</button></div>
          )}
          {msgs === null ? (
            <div className="tea-empty">{supabase ? 'Brewing…' : 'Offline'}</div>
          ) : msgs.length === 0 ? (
            <div className="tea-empty">
              {channel === 'general' ? "The kettle's on. Be the first to spill something ☕" : `Nothing in #${label(channel).toLowerCase()} yet. Got intel on ${label(channel)}? Start it.`}
            </div>
          ) : (
            msgs.map((m, i) => {
              const own = m.alias === profile?.alias;
              const prev = msgs[i - 1];
              const grouped = prev && prev.alias === m.alias && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60_000 && !m.reply_to;
              const parent = m.reply_to ? byId.get(m.reply_to) : null;
              const rx = m.reactions ?? {};
              return (
                <div key={m.id} className={`tea-msg${own ? ' mine' : ''}${grouped ? ' grouped' : ''}${m.is_admin ? ' mod' : ''}`}>
                  {!own && (
                    <span className="av" style={{ background: AVATAR_BG[Math.abs(hash(m.alias)) % AVATAR_BG.length], visibility: grouped ? 'hidden' : 'visible' }}>
                      {initials(m.alias)}
                    </span>
                  )}
                  <div className="tea-bubble-wrap">
                    {!grouped && (
                      <div className="tea-meta">
                        <b>{own ? 'You' : m.alias}</b>{m.is_admin && <ModTag />} <span>{clock(m.created_at)}</span>
                      </div>
                    )}
                    {m.hidden ? (
                      <div className="tea-bubble hidden-msg">Hidden after reports. A mod will review it.</div>
                    ) : (
                      <div className="tea-bubble">
                        {m.reply_to && (
                          <div className="tea-quote">
                            {parent ? <><b>{parent.alias}</b>{parent.is_admin && ' (MOD)'} {parent.body.slice(0, 90)}{parent.body.length > 90 ? '…' : ''}</> : <i>earlier message</i>}
                          </div>
                        )}
                        <Linkified text={m.body} />
                      </div>
                    )}
                    {!m.hidden && (
                      <div className="tea-rx">
                        {EMOJIS.map((e) => {
                          const n = rx[e] ?? 0;
                          const on = mine.has(`${m.id}:${e}`);
                          return (
                            <button key={e} className={`rx${n ? '' : ' zero'}${on ? ' on' : ''}`} onClick={() => react(m, e)} aria-pressed={on} aria-label={`${e} ${n}`}>
                              {e}{n > 0 && <span>{n}</span>}
                            </button>
                          );
                        })}
                        {canChat && (
                          <>
                            <button className="tea-act" onClick={() => { setReplyTo(m); inputRef.current?.focus(); }}>Reply</button>
                            {!own && <button className="tea-act" onClick={() => report(m)}>Report</button>}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {toast && <div className="tea-toast" role="status">{toast}</div>}

        {canChat ? (
          <form className="tea-compose" onSubmit={send}>
            {replyTo && (
              <div className="tea-replying">
                <span>Replying to <b>{replyTo.alias}</b>: {replyTo.body.slice(0, 60)}{replyTo.body.length > 60 ? '…' : ''}</span>
                <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><Icon name="x" size={14} /></button>
              </div>
            )}
            {warn && <div className="tea-err">Looks like this has {warn}. Remove it to keep everyone anonymous.</div>}
            {err && <div className="tea-err">{err}</div>}
            <div className="tea-input-row">
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => { setText(e.target.value.slice(0, 500)); setErr(''); }}
                onKeyDown={onKey}
                placeholder={`Message #${label(channel).toLowerCase()}`}
                title="Enter to send, Shift+Enter for a new line"
                rows={1}
                aria-label="Message"
              />
              <button className="tea-send" disabled={busy || !text.trim() || Boolean(warn)} aria-label="Send">
                <Icon name="arrow" size={20} />
              </button>
            </div>
            <div className="tea-count">{text.length}/500</div>
          </form>
        ) : (
          <div className="tea-locked">
            {err ? <span className="tea-err">{err}</span> : <span>Read freely. Sign in with your @{CHAT_DOMAIN} Google account to post, react or report.</span>}
          </div>
        )}
      </div>
    </div>
  );
}
