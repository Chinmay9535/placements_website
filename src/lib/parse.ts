// Turns the free-text the sheet is written in ("40k // 14lpa", "7-21lpa",
// "Ghosted", "gold - intern + ppo") into fields the site can sort & filter on.
// Raw text is always shown too — parsing only powers filters/stats.

export type CompanyRow = {
  id?: string;
  name: string;
  date_raw: string;
  role: string;
  ctc_raw: string;
  intake_raw: string;
  rounds: string;
  details: string;
  position: number;
  source?: 'sheet' | 'manual';
  created_at?: string;
};

export type TagKey =
  | 'ghosted'
  | 'stopped'
  | 'pbc'
  | 'bond'
  | 'internship'
  | 'apprentice'
  | 'ppo'
  | 'restricted'
  | 'gold'
  | 'silver';

export const TAGS: Record<TagKey, { label: string; hint: string; tone: 'bad' | 'warn' | 'neutral' | 'good' }> = {
  ghosted: { label: 'Ghosted', hint: 'Students never heard back', tone: 'bad' },
  stopped: { label: 'Stopped', hint: 'Drive was stopped / zero intake', tone: 'bad' },
  bond: { label: 'Bond', hint: 'Service bond attached', tone: 'warn' },
  pbc: { label: 'PBC', hint: 'Performance-based conversion — FTE not guaranteed', tone: 'warn' },
  apprentice: { label: 'Apprenticeship', hint: 'Apprentice role', tone: 'neutral' },
  internship: { label: 'Internship', hint: 'Has an internship component', tone: 'neutral' },
  ppo: { label: 'PPO / FTE', hint: 'Mentions a PPO or full-time conversion', tone: 'good' },
  restricted: { label: 'Branch-restricted', hint: 'Only some branches eligible', tone: 'neutral' },
  gold: { label: 'Gold', hint: 'Marked "gold" in the sheet', tone: 'good' },
  silver: { label: 'Silver', hint: 'Marked "silver" in the sheet', tone: 'neutral' },
};

export type Company = CompanyRow & {
  key: string;
  date: Date | null;
  ctcMin: number | null; // LPA
  ctcMax: number | null; // LPA
  stipendMax: number | null; // ₹ per month
  intake: number | null;
  intakeLabel: string;
  tags: TagKey[];
  hasInfo: boolean;
};

const num = (s: string) => parseFloat(s.replace(/,/g, ''));

export function parseDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? 2000 + +y : +y;
  const dt = new Date(year, +mo - 1, +d);
  return isNaN(dt.getTime()) ? null : dt;
}

export function parseMoney(raw: string) {
  let s = raw.toLowerCase().replace(/₹/g, ' ').replace(/,/g, '');
  let ctcMin: number | null = null;
  let ctcMax: number | null = null;
  let stipendMax: number | null = null;

  const addCtc = (a: number, b?: number) => {
    const lo = Math.min(a, b ?? a);
    const hi = Math.max(a, b ?? a);
    if (hi <= 0 || hi > 100) return;
    ctcMin = ctcMin == null ? lo : Math.min(ctcMin, lo);
    ctcMax = ctcMax == null ? hi : Math.max(ctcMax, hi);
  };
  const addStipend = (v: number) => {
    if (v <= 0) return;
    stipendMax = stipendMax == null ? v : Math.max(stipendMax, v);
  };

  // "7-21lpa", "3.5-9.09l", "8llpa", "10 lpa", "16 l"
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:l+pa|lakhs?|l)\b/g, (_, a, b) => {
    addCtc(num(a), num(b));
    return ' ';
  });
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:l+pa|lakhs?|l)\b/g, (_, a) => {
    addCtc(num(a));
    return ' ';
  });
  // "10-75k", "40k", "64K"
  s = s.replace(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*k\b/g, (_, _a, b) => {
    addStipend(num(b) * 1000);
    return ' ';
  });
  s = s.replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, a) => {
    addStipend(num(a) * 1000);
    return ' ';
  });
  // Bare numbers: ≥1000 is a monthly stipend ("22500", "15000 - 30000 per month"),
  // a small one left over is an LPA figure ("30k//10.75", "7.5").
  for (const m of s.matchAll(/\d+(?:\.\d+)?/g)) {
    const v = num(m[0]);
    if (v >= 1000) addStipend(v);
    else if (v >= 2 && v <= 60 && ctcMax == null) addCtc(v);
  }
  return { ctcMin, ctcMax, stipendMax } as { ctcMin: number | null; ctcMax: number | null; stipendMax: number | null };
}

export function parseIntake(raw: string): { intake: number | null; label: string } {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return { intake: null, label: '' };
  if (/mass/i.test(t)) return { intake: null, label: 'Mass hiring' };
  const nums = [...t.matchAll(/\d+/g)].map((m) => +m[0]);
  if (!nums.length) return { intake: null, label: t };
  // "20(intern+fte) + 4(only intern)" → 24
  const total = /\+/.test(t) && nums.length > 1 ? nums.reduce((a, b) => a + b, 0) : nums[0];
  return { intake: total, label: t };
}

export function deriveTags(c: CompanyRow, ctcMax: number | null, stipendMax: number | null): TagKey[] {
  const all = `${c.ctc_raw} ${c.rounds} ${c.details} ${c.role}`.toLowerCase();
  const tags = new Set<TagKey>();
  if (/ghost/.test(all)) tags.add('ghosted');
  if (/stopped|0 intake/.test(all) || c.intake_raw.trim() === '0') tags.add('stopped');
  if (/\bpbc\b|performance[- ]based|based on performance/.test(all)) tags.add('pbc');
  if (/bond/.test(all)) tags.add('bond');
  if (/apprentic/.test(all)) tags.add('apprentice');
  if (/intern|stipend/.test(all) || (stipendMax != null && ctcMax == null)) tags.add('internship');
  if (!tags.has('pbc') && /\bppo\b|conversion|\bfte\b|full[- ]time/.test(all) && !/no ppo|no promise|no details/.test(all)) tags.add('ppo');
  if (/\bonly\s+(cse|aiml|ai\s*&?\s*ml|ise|ece)|came for aiml/.test(all)) tags.add('restricted');
  if (/\bgold\b/.test(c.ctc_raw.toLowerCase())) tags.add('gold');
  if (/\bsilver\b/.test(c.ctc_raw.toLowerCase())) tags.add('silver');
  return [...tags];
}

export function enrich(rows: CompanyRow[]): Company[] {
  return rows.map((r, i) => {
    const { ctcMin, ctcMax, stipendMax } = parseMoney(r.ctc_raw);
    const { intake, label } = parseIntake(r.intake_raw);
    const tags = deriveTags(r, ctcMax, stipendMax);
    return {
      ...r,
      key: r.id ?? `row-${i}-${r.name}`,
      date: parseDate(r.date_raw),
      ctcMin,
      ctcMax,
      stipendMax,
      intake,
      intakeLabel: label,
      tags,
      hasInfo: Boolean(r.role || r.ctc_raw || r.rounds || r.details),
    };
  });
}

export const fmtLpa = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(v < 10 ? 2 : 1).replace(/\.?0+$/, '')} LPA`;
export const fmtStipend = (v: number) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}/mo`;

export function ctcLabel(c: Company): string | null {
  if (c.ctcMax == null) return null;
  if (c.ctcMin != null && c.ctcMin !== c.ctcMax) return `${c.ctcMin}–${fmtLpa(c.ctcMax)}`;
  return fmtLpa(c.ctcMax);
}

export const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
