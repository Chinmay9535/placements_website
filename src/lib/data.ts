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

export type Upcoming = {
  id: string;
  name: string;
  role: string;
  ctc_raw: string;
  eligibility: string;
  drive_date: string | null; // yyyy-mm-dd
  deadline: string | null; // ISO timestamp
  apply_link: string;
  notes: string;
  created_at: string;
};

export async function loadUpcoming(): Promise<Upcoming[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('upcoming_drives').select('*');
  if (error) return [];
  return data as Upcoming[];
}

const DAY = 86_400_000;
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
/** yyyy-mm-dd → local midnight */
export const localDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Still relevant to students: deadline not passed, or drive day is today/later, or no dates yet (TBA). */
export function isActive(u: Upcoming, now = Date.now()) {
  const deadlineOpen = u.deadline ? new Date(u.deadline).getTime() > now : false;
  const driveAhead = u.drive_date ? localDate(u.drive_date).getTime() >= startOfToday() : false;
  if (!u.deadline && !u.drive_date) return true;
  return deadlineOpen || driveAhead;
}

/** The next thing that happens — used for sorting and the countdown chip. */
export function nextEvent(u: Upcoming, now = Date.now()): { kind: 'deadline' | 'drive' | 'tba'; at: number } {
  if (u.deadline && new Date(u.deadline).getTime() > now) return { kind: 'deadline', at: new Date(u.deadline).getTime() };
  if (u.drive_date) return { kind: 'drive', at: localDate(u.drive_date).getTime() };
  return { kind: 'tba', at: Number.MAX_SAFE_INTEGER };
}

export function countdown(u: Upcoming, now = Date.now()): { text: string; urgent: boolean } {
  const ev = nextEvent(u, now);
  if (ev.kind === 'tba') return { text: 'Date TBA', urgent: false };
  if (ev.kind === 'deadline') {
    const ms = ev.at - now;
    const h = Math.floor(ms / 3_600_000);
    const m = Math.max(1, Math.floor((ms % 3_600_000) / 60_000));
    if (ms < 3_600_000) return { text: `Registration closes in ${m}m`, urgent: true };
    if (ms < DAY) return { text: `Registration closes in ${h}h ${m}m`, urgent: true };
    const d = Math.ceil(ms / DAY);
    return { text: `Registration closes in ${d} day${d > 1 ? 's' : ''}`, urgent: d <= 2 };
  }
  const days = Math.round((ev.at - startOfToday()) / DAY);
  if (days <= 0) return { text: 'Drive is today', urgent: true };
  if (days === 1) return { text: 'Drive is tomorrow', urgent: true };
  return { text: `Drive in ${days} days`, urgent: false };
}

const gcalStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const gcalDay = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/** "Add to Google Calendar" link: the drive day if known, else a 30-min reminder at the deadline. */
export function calendarLink(u: Upcoming): string | null {
  let dates: string;
  let title: string;
  if (u.drive_date) {
    const d = localDate(u.drive_date);
    dates = `${gcalDay(d)}/${gcalDay(new Date(d.getTime() + DAY))}`;
    title = `${u.name} placement drive`;
  } else if (u.deadline) {
    const end = new Date(u.deadline);
    dates = `${gcalStamp(new Date(end.getTime() - 30 * 60_000))}/${gcalStamp(end)}`;
    title = `${u.name}: registration closes`;
  } else return null;
  const details = [
    u.role && `Role: ${u.role}`,
    u.ctc_raw && `CTC: ${u.ctc_raw}`,
    u.eligibility && `Eligibility: ${u.eligibility}`,
    u.deadline && `Register by: ${new Date(u.deadline).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
    u.apply_link && `Apply: ${u.apply_link}`,
    'via bmsit-placements-27.onrender.com',
  ]
    .filter(Boolean)
    .join('\n');
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates, details });
  return `https://calendar.google.com/calendar/render?${q}`;
}
