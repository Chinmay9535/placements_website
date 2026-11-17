import { supabase } from './supabase';

export type Stage = 'applied' | 'shortlisted' | 'offer';
export type Counts = { applied: number; shortlisted: number; offers: number };

export const STAGES: { key: Stage; label: string; short: string }[] = [
  { key: 'applied', label: 'Applied', short: 'applied' },
  { key: 'shortlisted', label: 'Shortlisted', short: 'shortlisted' },
  { key: 'offer', label: 'Got the offer', short: 'offers' },
];

export async function loadProgressCounts(): Promise<Record<string, Counts>> {
  if (!supabase) return {};
  const { data, error } = await supabase.rpc('drive_progress_counts');
  if (error || !data) return {};
  const out: Record<string, Counts> = {};
  for (const r of data as { company_id: string; applied: number; shortlisted: number; offers: number }[]) {
    out[r.company_id] = { applied: Number(r.applied), shortlisted: Number(r.shortlisted), offers: Number(r.offers) };
  }
  return out;
}

export async function loadMyProgress(): Promise<Record<string, Stage>> {
  if (!supabase) return {};
  const { data, error } = await supabase.rpc('my_drive_progress');
  if (error || !data) return {};
  return Object.fromEntries((data as { company_id: string; stage: Stage }[]).map((r) => [r.company_id, r.stage]));
}

export async function setProgress(companyId: string, stage: Stage | null) {
  const { error } = await supabase!.rpc('set_drive_progress', { p_company: companyId, p_stage: stage ?? '' });
  if (error) throw error;
}
