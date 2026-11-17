import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CHAT_DOMAIN, supabase } from './supabase';

const RETURN_KEY = 'auth:return';

export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

/** Google sign-in hinted to the college domain. `returnTo` is an element id to scroll back to. */
export async function signInWithCollegeGoogle(returnTo = 'tea') {
  if (!supabase) return;
  try {
    localStorage.setItem(RETURN_KEY, returnTo);
  } catch {
    /* storage blocked */
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/`, queryParams: { hd: CHAT_DOMAIN, prompt: 'select_account' } },
  });
  if (error) throw error;
}

/** After the OAuth redirect, scroll back to where the user clicked "sign in". */
export function consumeAuthReturn() {
  try {
    const id = localStorage.getItem(RETURN_KEY);
    if (!id) return;
    localStorage.removeItem(RETURN_KEY);
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 400);
  } catch {
    /* ignore */
  }
}

export const errText = (e: unknown) => {
  const m = (e as { message?: string })?.message ?? String(e);
  return m.replace(/^.*?: (?=blocked|slow|only|you|message|unknown|login)/i, '').trim() || 'Something went wrong';
};
