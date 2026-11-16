import Papa from 'papaparse';
import snapshot from '../data/companies.json';
import type { CompanyRow } from './parse';
import { supabase, SHEET_ID } from './supabase';

export type Experience = {
  id: string;
  company_id: string;
  handle: string;
  outcome: 'selected' | 'rejected' | 'ghosted' | 'in-process' | 'info';
  body: string;
  created_at: string;
};

export type Submission = {
  id: string;
  name: string;
  date_raw: string;
  role: string;
  ctc_raw: string;
  intake_raw: string;
  details: string;
  status: 'pending' | 'approved' | 'dismissed';
  created_at: string;
};

export const OUTCOMES: Record<Experience['outcome'], string> = {
  selected: 'Got selected',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
  'in-process': 'Still in process',
  info: 'Just info',
};

export async function loadCompanies(): Promise<{ rows: CompanyRow[]; live: boolean }> {
  if (supabase) {
    const { data, error } = await supabase.from('companies').select('*').order('position', { ascending: false });
    if (!error && data && data.length) return { rows: data as CompanyRow[], live: true };
    if (error) console.warn('Supabase unavailable, using bundled snapshot', error.message);
  }
  return { rows: [...(snapshot as CompanyRow[])].reverse(), live: false };
}

export async function loadExperienceCounts(): Promise<Record<string, number>> {
  if (!supabase) return {};
  const { data } = await supabase.from('experiences').select('company_id');
  const counts: Record<string, number> = {};
  for (const r of data ?? []) counts[r.company_id] = (counts[r.company_id] ?? 0) + 1;
  return counts;
}

export async function loadExperiences(companyId: string): Promise<Experience[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('experiences')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return (data ?? []) as Experience[];
}

export async function loadRecentExperiences(limit = 6): Promise<Experience[]> {
  if (!supabase) return [];
  const { data } = await supabase.from('experiences').select('*').order('created_at', { ascending: false }).limit(limit);
  return (data ?? []) as Experience[];
}

/** Reads the public Google Sheet straight from the browser (export endpoint allows CORS). */
export async function fetchSheetRows(): Promise<CompanyRow[]> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`);
  if (!res.ok) throw new Error(`Sheet fetch failed (${res.status}). Is the sheet still public?`);
  const { data } = Papa.parse<string[]>(await res.text(), { skipEmptyLines: true });
  const clean = (s?: string) => (s ?? '').replace(/\r/g, '').trim();
  return data
    .slice(1)
    .filter((r) => clean(r[0]))
    .map((r, i) => ({
      name: clean(r[0]),
      date_raw: clean(r[1]),
      role: clean(r[2]),
      ctc_raw: clean(r[3]),
      intake_raw: clean(r[4]),
      rounds: clean(r[5]),
      details: clean(r[6]),
      position: i,
      source: 'sheet' as const,
    }));
}

/** Simple client-side throttle so one tab can't spam the anon insert endpoints. */
export function throttled(key: string, ms = 30_000): boolean {
  try {
    const last = Number(localStorage.getItem(`t:${key}`) ?? 0);
    if (Date.now() - last < ms) return true;
    localStorage.setItem(`t:${key}`, String(Date.now()));
  } catch {
    /* storage blocked — allow */
  }
  return false;
}
