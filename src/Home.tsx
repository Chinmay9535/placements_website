import { useCallback, useEffect, useMemo, useState } from 'react';
import { ctcLabel, enrich, fmtDate, fmtLpa, fmtStipend, TAGS, type Company, type TagKey } from './lib/parse';
import { loadCompanies, loadExperienceCounts, loadRecentExperiences, OUTCOMES, type Experience } from './lib/data';
import { SHEET_URL, supabase } from './lib/supabase';
import { Icon, Nav, Squiggle, TagList, timeAgo, useReveal } from './components/ui';
import { BarChart } from './components/BarChart';
import { CompanySheet } from './components/CompanySheet';
import { SubmitDrive } from './components/SubmitDrive';
import { Tea } from './components/Tea';

const REPO_URL = 'https://github.com/Chinmay9535/placements_website';

type Sort = 'latest' | 'ctc' | 'stipend' | 'intake' | 'az';
type Band = 'any' | '8' | '12' | '16';
const FILTER_TAGS: TagKey[] = ['internship', 'ppo', 'pbc', 'bond', 'apprentice', 'ghosted', 'stopped'];
const PAGE = 24;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export default function Home() {
  const [rows, setRows] = useState<Company[] | null>(null);
  const [live, setLive] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<Experience[]>([]);
  const [open, setOpen] = useState<Company | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [q, setQ] = useState('');
  const [tags, setTags] = useState<TagKey[]>([]);
  const [band, setBand] = useState<Band>('any');
  const [sort, setSort] = useState<Sort>('latest');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [limit, setLimit] = useState(PAGE);

  const refreshCommunity = useCallback(() => {
    loadExperienceCounts().then(setCounts);
    loadRecentExperiences(9).then(setRecent);
  }, []);

  useEffect(() => {
    loadCompanies().then(({ rows, live }) => {
      setRows(enrich(rows));
      setLive(live);
    });
    refreshCommunity();
  }, [refreshCommunity]);

  useReveal();

  const all = rows ?? [];
  const byId = useMemo(() => new Map(all.map((c) => [c.id ?? c.key, c])), [all]);

  const stats = useMemo(() => {
    const ctcs = all.filter((c) => c.ctcMax != null);
    const top = [...ctcs].sort((a, b) => b.ctcMax! - a.ctcMax!)[0];
    const stip = all.filter((c) => c.stipendMax != null).sort((a, b) => b.stipendMax! - a.stipendMax!)[0];
    const n = (t: TagKey) => all.filter((c) => c.tags.includes(t)).length;
    return {
      total: all.length,
      top,
      stip,
      median: median(ctcs.map((c) => c.ctcMax!)),
      withCtc: ctcs.length,
      ghosted: n('ghosted'),
      pbc: n('pbc'),
      bond: n('bond'),
      stopped: n('stopped'),
      internOnly: all.filter((c) => c.stipendMax != null && c.ctcMax == null).length,
      noInfo: all.filter((c) => !c.hasInfo).length,
      tagCounts: Object.fromEntries(FILTER_TAGS.map((t) => [t, n(t)])) as Record<TagKey, number>,
    };
  }, [all]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = all.filter((c) => {
      if (needle && !`${c.name} ${c.role} ${c.ctc_raw} ${c.rounds} ${c.details}`.toLowerCase().includes(needle)) return false;
      if (tags.length && !tags.every((t) => c.tags.includes(t))) return false;
      if (band !== 'any' && !(c.ctcMax != null && c.ctcMax >= +band)) return false;
      return true;
    });
    const nullsLast = (v: number | null) => (v == null ? -Infinity : v);
    if (sort === 'ctc') list = [...list].sort((a, b) => nullsLast(b.ctcMax) - nullsLast(a.ctcMax));
    if (sort === 'stipend') list = [...list].sort((a, b) => nullsLast(b.stipendMax) - nullsLast(a.stipendMax));
    if (sort === 'intake') list = [...list].sort((a, b) => nullsLast(b.intake) - nullsLast(a.intake));
    if (sort === 'az') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [all, q, tags, band, sort]);

  useEffect(() => setLimit(PAGE), [q, tags, band, sort]);

  const bands = useMemo(() => {
    const defs: [string, number, number][] = [['< 5', 0, 5], ['5–8', 5, 8], ['8–12', 8, 12], ['12–16', 12, 16], ['16+', 16, 999]];
    return defs.map(([label, lo, hi]) => {
      const inBand = all.filter((c) => c.ctcMax != null && c.ctcMax >= lo && c.ctcMax < hi);
      return { label: `${label} L`, value: inBand.length, tip: inBand.slice(0, 4).map((c) => c.name).join(', ') + (inBand.length > 4 ? '…' : '') };
    });
  }, [all]);

  const months = useMemo(() => {
    const dated = all.filter((c) => c.date);
    if (!dated.length) return [];
    const keys = dated.map((c) => c.date!.getFullYear() * 12 + c.date!.getMonth());
    const lo = Math.min(...keys);
    const hi = Math.max(...keys);
    const out = [];
    for (let k = lo; k <= hi; k++) {
      const inM = dated.filter((c) => c.date!.getFullYear() * 12 + c.date!.getMonth() === k);
      const d = new Date(Math.floor(k / 12), k % 12, 1);
      out.push({
        label: d.toLocaleDateString('en-IN', { month: 'short' }),
        value: inM.length,
        tip: `${d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}: ${inM.slice(0, 3).map((c) => c.name.trim()).join(', ')}${inM.length > 3 ? '…' : ''}`,
        highlight: k === hi,
      });
    }
    return out;
  }, [all]);

  const topPay = useMemo(() => [...all].filter((c) => c.ctcMax != null).sort((a, b) => b.ctcMax! - a.ctcMax!).slice(0, 8), [all]);
  const latest = all.slice(0, 16);
  const toggleTag = (t: TagKey) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <div className="wrap">
      {/* ───────── HERO ───────── */}
      <header className="frame">
        <Nav onSubmit={() => setSubmitting(true)} />
        <div className="hero">
          <div className="hero-copy">
            <div className="eyebrow" style={{ marginBottom: 14 }}>BMSIT &amp; M · Batch of 2027</div>
            <h1 className="display">
              Placements,
              <em>unfiltered</em>
            </h1>
          </div>
        </div>
        <div className="hero-phone">
          <Phone latest={latest.slice(0, 4)} top={stats.top} onOpen={setOpen} />
        </div>
        <div className="hero-panel">
          <Squiggle style={{ left: -60, bottom: -50, opacity: 0.9 }} width={1000} />
          <p>
            Every company that's come to campus for the 2027 batch: CTC, stipend, intake, the rounds, and the drives that
            ghosted us. Crowd-sourced by students, no PR filter.
          </p>
          <div className="row">
            <a className="btn dark" href="#drives">Browse {stats.total || ''} drives</a>
            <button className="btn" onClick={() => setSubmitting(true)}>Add a new one</button>
          </div>
          <div className="hero-note">
            <span className="dot" />
            {live ? 'Live — updated by students as drives drop' : 'Snapshot of the community sheet'} · not affiliated with BMSIT
          </div>
        </div>
      </header>

      {/* latest marquee */}
      {latest.length > 0 && (
        <div className="frame" style={{ borderRadius: 999 }}>
          <div className="marquee" aria-label="Latest drives">
            <div className="marquee-track">
              {[...latest, ...latest].map((c, i) => (
                <span className="marquee-item" key={`${c.key}-${i}`} aria-hidden={i >= latest.length}>
                  <i />
                  <b>{c.name.trim()}</b>
                  <span>{ctcLabel(c) ?? (c.stipendMax ? fmtStipend(c.stipendMax) : c.tags.includes('ghosted') ? 'ghosted' : 'tbd')}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ───────── STATS ───────── */}
      <section className="frame white reveal">
        <div className="inner">
          <div className="stats-grid">
            <div className="stat">
              <div className="num">{stats.total}<sup>+</sup></div>
              <div className="lbl">Companies<br />so far</div>
            </div>
            <div className="stat">
              <div className="num">{stats.top?.ctcMax ?? '—'}<sup>LPA</sup></div>
              <div className="lbl">Highest<br />CTC</div>
              {stats.top && <div className="sub">{stats.top.name.trim()}</div>}
            </div>
            <div className="stat">
              <div className="num">{stats.median ? +stats.median.toFixed(1) : '—'}<sup>LPA</sup></div>
              <div className="lbl">Median<br />CTC</div>
              <div className="sub">across {stats.withCtc} drives with a number</div>
            </div>
            <div className="stat">
              <div className="num">{stats.ghosted}</div>
              <div className="lbl">Ghosted<br />us</div>
              <div className="sub">no reply after rounds</div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── DRIVES ───────── */}
      <section className="frame" id="drives">
        <div className="inner">
          <div className="section-head">
            <h2 className="h2">Every drive<br /><em>so far</em></h2>
            <div className="aside-italic">
              The good, the bond<br />and the ghosted
              <small>Click any company for rounds, eligibility &amp; experiences.</small>
            </div>
          </div>

          <div className="controls">
            <div className="controls-row">
              <label className="search">
                <Icon name="search" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, role, rounds… try “dsa”" aria-label="Search drives" />
                {q && <button className="chip" onClick={() => setQ('')} aria-label="Clear search" style={{ padding: '2px 8px' }}><Icon name="x" size={14} /></button>}
              </label>
              <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
                <option value="latest">Latest first</option>
                <option value="ctc">Highest CTC</option>
                <option value="stipend">Highest stipend</option>
                <option value="intake">Most hires</option>
                <option value="az">A → Z</option>
              </select>
              <div className="seg" role="group" aria-label="View">
                <button aria-pressed={view === 'cards'} onClick={() => setView('cards')} aria-label="Card view"><Icon name="grid" size={16} /></button>
                <button aria-pressed={view === 'table'} onClick={() => setView('table')} aria-label="Table view"><Icon name="list" size={16} /></button>
              </div>
            </div>
            <div className="controls-row">
              <div className="chips" role="group" aria-label="CTC">
                {(['any', '8', '12', '16'] as Band[]).map((b) => (
                  <button key={b} className="chip" aria-pressed={band === b} onClick={() => setBand(b)}>
                    {b === 'any' ? 'Any CTC' : `${b}+ LPA`}
                  </button>
                ))}
              </div>
              <span className="chip-divider" style={{ width: 1, height: 22, background: 'var(--line-strong)' }} />
              <div className="chips" role="group" aria-label="Tags">
                {FILTER_TAGS.map((t) => (
                  <button key={t} className="chip" aria-pressed={tags.includes(t)} onClick={() => toggleTag(t)} title={TAGS[t].hint}>
                    {TAGS[t].label} <span className="count">{stats.tagCounts[t]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="result-line">
              {rows ? `${filtered.length} of ${all.length} drives` : 'Loading drives…'}
              {(q || tags.length > 0 || band !== 'any') && (
                <button className="chip" style={{ marginLeft: 10 }} onClick={() => { setQ(''); setTags([]); setBand('any'); }}>Reset filters</button>
              )}
            </div>
          </div>

          {!rows ? (
            <div className="grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="empty">Nothing matches. Loosen a filter, or <button className="chip" onClick={() => setSubmitting(true)}>add the drive yourself</button></div>
          ) : view === 'cards' ? (
            <div className="grid">
              {filtered.slice(0, limit).map((c) => <DriveCard key={c.key} c={c} n={counts[c.id ?? ''] ?? 0} onOpen={setOpen} />)}
            </div>
          ) : (
            <DriveTable list={filtered.slice(0, limit)} counts={counts} onOpen={setOpen} />
          )}
          {filtered.length > limit && (
            <div className="more-row">
              <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</button>
            </div>
          )}
        </div>
      </section>

      {/* ───────── INSIGHTS ───────── */}
      <section className="frame reveal" id="insights">
        <div className="inner">
          <div className="section-head">
            <h2 className="h2">Where the<br /><em>money is</em></h2>
            <div className="aside-italic">
              Numbers pulled from<br />what students wrote
              <small>Ranges count at their top end. Stipend-only drives aren't in the CTC charts.</small>
            </div>
          </div>
          <div className="insights">
            <div className="panel">
              <h3>Drives by CTC band</h3>
              <p className="desc">Number of companies whose offer tops out in each range (LPA)</p>
              <BarChart data={bands} unit="companies" />
            </div>
            <div className="panel">
              <h3>Top of the table</h3>
              <p className="desc">Highest CTC mentioned for each drive</p>
              <ol className="leaderboard">
                {topPay.map((c, i) => (
                  <li key={c.key} onClick={() => setOpen(c)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(c)}>
                    <span className="rk">{String(i + 1).padStart(2, '0')}</span>
                    <span>
                      <b>{c.name.trim()}</b>
                      <div className="bar-inline" style={{ width: `${(c.ctcMax! / topPay[0].ctcMax!) * 100}%` }} />
                    </span>
                    <span className="v">{fmtLpa(c.ctcMax!)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="panel">
              <h3>When drives landed</h3>
              <p className="desc">Drives per month, for the ones with an application date in the sheet</p>
              {months.length ? <BarChart data={months} unit="drives" /> : <p className="note">No dates yet.</p>}
            </div>
            <div className="panel">
              <h3>The fine print</h3>
              <p className="desc">What the offer letters don't put up front</p>
              <div className="fineprint">
                <div className="fp lav"><div className="n">{stats.ghosted}</div><div className="l">ghosted after rounds</div></div>
                <div className="fp rose"><div className="n">{stats.stopped}</div><div className="l">stopped or hired zero</div></div>
                <div className="fp sage"><div className="n">{stats.pbc}</div><div className="l">PBC — FTE not guaranteed</div></div>
                <div className="fp sky"><div className="n">{stats.bond}</div><div className="l">came with a bond</div></div>
                <div className="fp"><div className="n">{stats.internOnly}</div><div className="l">stipend only, no CTC</div></div>
                <div className="fp"><div className="n">{stats.stip ? fmtStipend(stats.stip.stipendMax!) : '—'}</div><div className="l">top stipend{stats.stip ? ` · ${stats.stip.name.trim()}` : ''}</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── WHY ───────── */}
      <section className="frame white reveal">
        <div className="inner">
          <div className="section-head">
            <h2 className="h2">Why this<br />exists</h2>
            <div className="aside-italic">
              Because the official<br />numbers never say<br />who ghosted
            </div>
          </div>
          <div className="why">
            <div className="why-card lav">
              <span className="ico"><Icon name="eye" /></span>
              <div>
                <h3>Raw,<br />not curated</h3>
                <p>Straight from the sheet the batch keeps. Ghostings, bonds and stopped drives stay on the record.</p>
              </div>
            </div>
            <div className="why-card white">
              <Squiggle style={{ right: -420, top: -110, opacity: 0.3, transform: 'rotate(-20deg)' }} width={700} />
              <span className="ico"><Icon name="users" /></span>
              <div>
                <h3>Free, no login<br />to read</h3>
                <p>No paywall, no "premium prep". Login only to chat on placemenTEA, and even then you're a random alias.</p>
              </div>
            </div>
            <div className="why-card sage">
              <span className="ico"><Icon name="zap" /></span>
              <div>
                <h3>Updated as<br />drives drop</h3>
                <p>New company in the mail? Add it in 30 seconds. It shows up after a quick check.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── EXPERIENCES ───────── */}
      <section className="frame reveal" id="experiences">
        <div className="inner">
          <div className="section-head">
            <h2 className="h2">Straight from<br /><em>the batch</em></h2>
            <div className="aside-italic">
              OA questions, interview<br />topics, red flags
              <small>Open any company to post yours — anonymous by default.</small>
            </div>
          </div>
          {recent.length ? (
            <div className="wall">
              {recent.map((x) => {
                const c = byId.get(x.company_id);
                return (
                  <div className="exp" key={x.id}>
                    <div className="who">
                      <span className="co" onClick={() => c && setOpen(c)}>{c?.name.trim() ?? 'Unknown company'}</span>
                      <span className={`outcome ${x.outcome}`}>{OUTCOMES[x.outcome]}</span>
                    </div>
                    <p>{x.body}</p>
                    <div className="who" style={{ marginTop: 10, marginBottom: 0 }}>{x.handle || 'anonymous'} · {timeAgo(x.created_at)}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="panel" style={{ display: 'flex', gap: 20, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div>
                <h3>No experiences yet</h3>
                <p className="desc" style={{ margin: 0 }}>
                  {supabase ? 'Be the first. Pick a company you went through and write what the rounds were really like.' : 'Experiences open up once the live database is connected.'}
                </p>
              </div>
              <a className="btn dark" href="#drives">Pick a company</a>
            </div>
          )}
        </div>
      </section>

      {/* ───────── placemenTEA ───────── */}
      <section className="frame tea" id="tea">
        <div className="inner">
          <div className="section-head">
            <h2 className="h2">placemen<em>TEA</em></h2>
            <div className="aside-italic">
              Spill it.<br />Anonymously.
              <small>Live chat for the batch. Random aliases, college login only.</small>
            </div>
          </div>
          <Tea />
        </div>
      </section>

      {/* ───────── FOOTER ───────── */}
      <footer className="footer">
        <FooterArt />
        <div className="footer-pills">
          <span className="btn sm">Unofficial</span>
          <span className="btn sm">Student-run</span>
          <span className="btn sm">Open data</span>
        </div>
        <div className="inner">
          <BrandMark2 />
          <h2 className="footer-title">
            Heard about <span className="heart" aria-hidden><svg width="50%" viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.3C1 8.4 3 5 6.3 5c2 0 3.5 1.1 4.2 2.4h3C14.2 6.1 15.7 5 17.7 5 21 5 23 8.4 21.6 11.7 19.5 16.4 12 21 12 21z" fill="#fff" /></svg></span> a drive?<br />
            Drop it here.
          </h2>
          <div className="footer-links">
            <button onClick={() => setSubmitting(true)}>
              <Icon name="send" size={26} />
              <span><span className="k">New company on campus</span><br /><span className="v">Add a drive</span></span>
            </button>
            <a href={SHEET_URL} target="_blank" rel="noreferrer">
              <Icon name="sheet" size={26} />
              <span><span className="k">The raw data</span><br /><span className="v">Open the sheet</span></span>
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              <Icon name="git" size={26} />
              <span><span className="k">Source code</span><br /><span className="v">GitHub repo</span></span>
            </a>
          </div>
          <p className="disclaimer">
            Not affiliated with BMSIT&amp;M or its placement cell. Everything here is crowd-sourced and can be wrong or out of date —
            always confirm with the official placement mail before you decide anything. · <a href="/privacy">Privacy policy</a>
          </p>
        </div>
      </footer>

      {open && <CompanySheet c={open} onClose={() => setOpen(null)} onPosted={refreshCommunity} />}
      {submitting && <SubmitDrive onClose={() => setSubmitting(false)} />}
    </div>
  );
}

function DriveCard({ c, n, onOpen }: { c: Company; n: number; onOpen: (c: Company) => void }) {
  const ctc = ctcLabel(c);
  const bad = c.tags.includes('ghosted') || c.tags.includes('stopped');
  const tone = bad ? 'tone-rose dim' : c.tags.includes('gold') ? 'tone-lav' : (c.ctcMax ?? 0) >= 15 ? 'tone-sage' : '';
  return (
    <button className={`card ${tone}`} onClick={() => onOpen(c)}>
      <div className="card-top">
        <h3>{c.name.trim()}</h3>
        {c.date && <span className="date">{fmtDate(c.date)}</span>}
      </div>
      {c.role && <div className="role">{c.role.replace(/\n/g, ' · ')}</div>}
      <div className="money">
        {ctc ? <span className="ctc">{ctc}</span> : c.stipendMax ? null : <span className="ctc none">{c.ctc_raw && c.ctc_raw.length < 28 ? c.ctc_raw : 'CTC not shared'}</span>}
        {c.stipendMax && <span className={ctc ? 'stipend' : 'ctc'}>{fmtStipend(c.stipendMax)}{ctc ? ' stipend' : ''}</span>}
      </div>
      <div className="card-foot">
        <TagList tags={c.tags} max={3} />
        <span style={{ display: 'flex', gap: 10 }}>
          {c.intakeLabel && <span className="meta-mini"><Icon name="users" size={14} />{c.intake ?? c.intakeLabel}</span>}
          {n > 0 && <span className="meta-mini"><Icon name="chat" size={14} />{n}</span>}
        </span>
      </div>
    </button>
  );
}

function DriveTable({ list, counts, onOpen }: { list: Company[]; counts: Record<string, number>; onOpen: (c: Company) => void }) {
  return (
    <div className="table-wrap">
      <table className="drives">
        <thead>
          <tr>
            <th>Company</th><th>Date</th><th>Role</th><th>CTC</th><th>Stipend</th><th>Intake</th><th>Flags</th><th aria-label="Experiences" />
          </tr>
        </thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.key} onClick={() => onOpen(c)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(c)}>
              <td className="name">{c.name.trim()}</td>
              <td className="num">{c.date ? fmtDate(c.date) : '—'}</td>
              <td style={{ maxWidth: 260 }}>{c.role.replace(/\n/g, ' · ') || '—'}</td>
              <td className="num">{ctcLabel(c) ?? '—'}</td>
              <td className="num">{c.stipendMax ? fmtStipend(c.stipendMax) : '—'}</td>
              <td className="num">{c.intake ?? (c.intakeLabel || '—')}</td>
              <td><TagList tags={c.tags} max={2} /></td>
              <td className="num">{counts[c.id ?? ''] ? <span className="meta-mini"><Icon name="chat" size={14} />{counts[c.id!]}</span> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Phone({ latest, top, onOpen }: { latest: Company[]; top?: Company; onOpen: (c: Company) => void }) {
  return (
    <div className="phone" aria-hidden>
      <div className="phone-screen">
        <div className="phone-top">
          <div className="phone-island" />
          <div className="phone-status"><span>9:41</span><span>●●● ▮</span></div>
          <Squiggle style={{ right: -180, top: 4, opacity: 0.5, transform: 'scale(.5)' }} width={500} />
          <div className="phone-title">My Drives</div>
          <div className="phone-tabs"><span>LATEST</span><span>TOP PAY</span><span>GHOSTED</span></div>
        </div>
        <div className="phone-body">
          <div className="phone-tip">
            <span style={{ color: 'var(--muted)' }}>Tip for the season</span>
            <b>Write down the OA questions</b>
            Right after the test, while you remember. Post them on the company page — juniors will thank you.
          </div>
          {top && (
            <div className="phone-feature" onClick={() => onOpen(top)} style={{ cursor: 'pointer', pointerEvents: 'auto' }}>
              <h4>{top.name.trim()}</h4>
              <div>{top.role || 'Role not listed'}</div>
              <div className="meta">
                <span><b>{ctcLabel(top)}</b>{top.stipendMax ? ` · ${fmtStipend(top.stipendMax)}` : ''}</span>
                <span className="pill">Explore</span>
              </div>
            </div>
          )}
          <div className="phone-list">
            {latest.map((c) => (
              <div className="phone-item" key={c.key}>
                <b>{c.name.trim()}</b>
                <span>{ctcLabel(c) ?? (c.stipendMax ? fmtStipend(c.stipendMax) : '—')}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="phone-nav"><span>Home</span><span>Drives</span><span>Insights</span><span>Profile</span></div>
      </div>
    </div>
  );
}

function BrandMark2() {
  return (
    <div style={{ width: 84, height: 84, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center', marginBottom: 32 }}>
      <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden>
        <path d="M5 19c3-8 7-8 10-3s6 5 12-4" fill="none" stroke="#231212" strokeWidth="3.6" strokeLinecap="round" />
        <circle cx="27" cy="12" r="2.4" fill="#231212" />
      </svg>
    </div>
  );
}

/** Original geometric pattern: soft blob + circles, diamonds and tiles in the site palette. */
function FooterArt() {
  return (
    <svg className="footer-art" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <path d="M60 120 C 200 20, 420 40, 520 110 S 560 260, 440 300 S 260 360, 330 470 S 420 640, 300 690 L 160 690 C 120 600, 210 520, 170 440 S 20 340, 60 120Z" fill="#bdb8e3" opacity="0.75" />
      <g opacity="0.9">
        <circle cx="830" cy="80" r="56" fill="#fff" /><circle cx="830" cy="80" r="24" fill="#b9c9d4" />
        <rect x="940" y="20" width="36" height="36" fill="#e3e2f7" /><rect x="976" y="56" width="36" height="36" fill="#e3e2f7" />
        <rect x="976" y="20" width="36" height="36" fill="#fff" opacity="0.6" /><rect x="940" y="56" width="36" height="36" fill="#fff" opacity="0.6" />
        <g transform="translate(1090 330) rotate(45)"><rect x="-50" y="-50" width="100" height="100" fill="none" stroke="#e2e6cf" strokeWidth="10" /><rect x="-28" y="-28" width="56" height="56" fill="none" stroke="#e2e6cf" strokeWidth="10" /></g>
        <circle cx="1140" cy="520" r="70" fill="#fff" /><path d="M1140 450 A70 70 0 0 1 1140 590 Z" fill="#c7c4ee" />
        <g transform="translate(700 600) rotate(45)"><rect x="-44" y="-44" width="88" height="88" fill="none" stroke="#f2cfcf" strokeWidth="8" /><rect x="-22" y="-22" width="44" height="44" fill="#f2cfcf" /></g>
        <circle cx="980" cy="640" r="48" fill="none" stroke="#fff" strokeWidth="22" />
        <path d="M560 560 l40 -60 l40 60 z" fill="#e3a3a6" opacity="0.6" />
        <circle cx="610" cy="40" r="28" fill="#e2e6cf" />
        <g fill="#c7c4ee" opacity="0.8"><circle cx="820" cy="420" r="22" /><circle cx="866" cy="420" r="22" /><circle cx="820" cy="466" r="22" /><circle cx="866" cy="466" r="22" /></g>
        <path d="M40 520 h70 a35 35 0 0 1 0 70 h-70z" fill="#b9c9d4" />
      </g>
    </svg>
  );
}
