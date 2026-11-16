import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** null when the site is built without Supabase env vars — it then runs read-only from the bundled sheet snapshot. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { flowType: 'pkce' } }) : null;

export const SHEET_ID = (import.meta.env.VITE_SHEET_ID as string | undefined) || '1fVKOd1KZotNep2suDczCnmWm2_UOq_vCmIvtzX7yytk';
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;

/** Chat is limited to college Google accounts (also enforced in the database). */
export const CHAT_DOMAIN = 'bmsit.in';
