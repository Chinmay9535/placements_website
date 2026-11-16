import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CHAT_DOMAIN, supabase } from '../lib/supabase';
import { Icon } from './ui';

type Msg = { id: number; alias: string; body: string; reply_to: number | null; created_at: string };
type Profile = { alias: string; banned: boolean };

const PAGE = 60;
const RETURN_KEY = 'tea:return';
const AVATAR_BG = ['#e3e2f7', '#e2e6cf', '#f2cfcf', '#d4ecf7', '#c7c4ee', '#c9d0a6', '#e3a3a6', '#b9c9d4'];

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const initials = (alias: string) => alias.split(' ').slice(0, 2).map((w) => w[0]).join('');
const emailOk = (s: Session | null) => {
  const e = s?.user.email?.toLowerCase() ?? '';
  return e.endsWith(`@${CHAT_DOMAIN}`) && s?.user.app_metadata?.provider === 'google';
};

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

function errText(e: unknown) {
  const m = (e as { message?: string })?.message ?? String(e);
  return m.replace(/^.*?: /, '').trim() || 'Something went wrong';
}

export function Tea() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── auth ──
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session || !emailOk(session)) return setProfile(null);
    supabase.rpc('my_chat_profile').then(({ data, error }) => {
      if (error) setErr(errText(error));
      else setProfile(data as Profile);
    });
    try {
      if (localStorage.getItem(RETURN_KEY)) {
        localStorage.removeItem(RETURN_KEY);
        setTimeout(() => document.getElementById('tea')?.scrollIntoView({ behavior: 'smooth' }), 300);
      }
    } catch {
      /* storage blocked */
    }
  }, [session]);

  // ── messages + realtime ──
  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    sb.from('chat_messages')
      .select('*')
      .order('id', { ascending: false })
      .limit(PAGE)
      .then(({ data }) => {
        const rows = ((data ?? []) as Msg[]).reverse();
        setMsgs(rows);
        setHasOlder(rows.length === PAGE);
      });

    const ch = sb
      .channel('placementea', { config: { presence: { key: crypto.randomUUID?.() ?? String(Math.random()) } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (p) => {
        const m = p.new as Msg;
        setMsgs((cur) => (cur && !cur.some((x) => x.id === m.id) ? [...cur, m] : cur));
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

  // keep the view pinned to the newest message unless the reader scrolled up
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
    const { data } = await supabase.from('chat_messages').select('*').lt('id', msgs[0].id).order('id', { ascending: false }).limit(PAGE);
    const older = ((data ?? []) as Msg[]).reverse();
    stick.current = false;
    setMsgs((cur) => [...older, ...(cur ?? [])]);
    setHasOlder(older.length === PAGE);
    requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight - before));
  }, [msgs]);

  async function signIn() {
    if (!supabase) return;
    try {
      localStorage.setItem(RETURN_KEY, '1');
    } catch {
      /* ignore */
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { hd: CHAT_DOMAIN, prompt: 'select_account' },
      },
    });
    if (error) setErr(errText(error));
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!supabase || busy) return;
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setErr('');
    const { data, error } = await supabase.rpc('post_chat', { p_body: body, p_reply_to: replyTo?.id ?? null });
    setBusy(false);
    if (error) return setErr(errText(error));
    const m = data as Msg;
    stick.current = true;
    setMsgs((cur) => (cur && !cur.some((x) => x.id === m.id) ? [...cur, m] : cur));
    setText('');
    setReplyTo(null);
    inputRef.current?.focus();
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const byId = new Map((msgs ?? []).map((m) => [m.id, m]));
  const wrongAccount = session && !emailOk(session);
  const canChat = Boolean(profile && !profile.banned);

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
          <li>No leaking live test papers. Discuss after the drive.</li>
          <li>Mods can delete messages and ban aliases.</li>
          <li>Others only ever see your alias. The site never shows who's behind one, but the project owner could technically look it up in the database, so don't post anything you'd regret.</li>
        </ul>
      </aside>

      <div className="tea-chat">
        <div className="tea-list" ref={listRef} onScroll={onScroll} aria-live="polite" aria-label="placemenTEA messages">
          {hasOlder && (
            <div className="tea-older"><button className="chip" onClick={loadOlder}>Load older messages</button></div>
          )}
          {msgs === null ? (
            <div className="tea-empty">{supabase ? 'Brewing…' : 'Offline'}</div>
          ) : msgs.length === 0 ? (
            <div className="tea-empty">The kettle's on. Be the first to spill something ☕</div>
          ) : (
            msgs.map((m, i) => {
              const mine = m.alias === profile?.alias;
              const prev = msgs[i - 1];
              const grouped = prev && prev.alias === m.alias && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000 && !m.reply_to;
              const parent = m.reply_to ? byId.get(m.reply_to) : null;
              return (
                <div key={m.id} className={`tea-msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}>
                  {!mine && (
                    <span className="av" style={{ background: AVATAR_BG[Math.abs(hash(m.alias)) % AVATAR_BG.length], visibility: grouped ? 'hidden' : 'visible' }}>
                      {initials(m.alias)}
                    </span>
                  )}
                  <div className="tea-bubble-wrap">
                    {!grouped && (
                      <div className="tea-meta">
                        <b>{mine ? 'You' : m.alias}</b> <span>{clock(m.created_at)}</span>
                      </div>
                    )}
                    <div className="tea-bubble">
                      {m.reply_to && (
                        <div className="tea-quote">
                          {parent ? <><b>{parent.alias}</b> {parent.body.slice(0, 90)}{parent.body.length > 90 ? '…' : ''}</> : <i>earlier message</i>}
                        </div>
                      )}
                      <Linkified text={m.body} />
                    </div>
                    {canChat && (
                      <button className="tea-reply" onClick={() => { setReplyTo(m); inputRef.current?.focus(); }} aria-label={`Reply to ${m.alias}`}>
                        Reply
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {canChat ? (
          <form className="tea-compose" onSubmit={send}>
            {replyTo && (
              <div className="tea-replying">
                <span>Replying to <b>{replyTo.alias}</b>: {replyTo.body.slice(0, 60)}{replyTo.body.length > 60 ? '…' : ''}</span>
                <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><Icon name="x" size={14} /></button>
              </div>
            )}
            {err && <div className="tea-err">{err}</div>}
            <div className="tea-input-row">
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 500))}
                onKeyDown={onKey}
                placeholder="Spill the tea…"
                title="Enter to send, Shift+Enter for a new line"
                rows={1}
                aria-label="Message"
              />
              <button className="tea-send" disabled={busy || !text.trim()} aria-label="Send">
                <Icon name="arrow" size={20} />
              </button>
            </div>
            <div className="tea-count">{text.length}/500</div>
          </form>
        ) : (
          <div className="tea-locked">
            {err ? <span className="tea-err">{err}</span> : <span>Read freely. Sign in with your @{CHAT_DOMAIN} Google account to post.</span>}
          </div>
        )}
      </div>
    </div>
  );
}
