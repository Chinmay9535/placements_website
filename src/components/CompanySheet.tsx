import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ctcLabel, fmtStipend, type Company } from '../lib/parse';
import { loadExperiences, OUTCOMES, throttled, type Experience } from '../lib/data';
import { supabase } from '../lib/supabase';
import { Modal, TagList, timeAgo } from './ui';
import { ProgressPanel } from './Extras';
import { openTeaChannel } from './Tea';
import type { Counts, Stage } from '../lib/progress';
import { setProgress } from '../lib/progress';
import { errText, signInWithCollegeGoogle } from '../lib/auth';

export type ProgressProps = {
  counts?: Counts;
  mine?: Stage;
  canSet: boolean;
  signedInWrong: boolean;
  onChanged: () => void;
};

function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer noopener">{p}</a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function Block({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="block">
      <div className="k">{k}</div>
      <div className="v">{children}</div>
    </div>
  );
}

export function CompanySheet({ c, onClose, onPosted, progress }: { c: Company; onClose: () => void; onPosted?: () => void; progress: ProgressProps }) {
  const [pBusy, setPBusy] = useState(false);
  const [pErr, setPErr] = useState('');
  async function onSetStage(s: Stage | null) {
    if (!c.id) return;
    setPBusy(true);
    setPErr('');
    try {
      await setProgress(c.id, s);
      progress.onChanged();
    } catch (e) {
      setPErr(errText(e));
    }
    setPBusy(false);
  }
  const [items, setItems] = useState<Experience[] | null>(null);
  const [body, setBody] = useState('');
  const [handle, setHandle] = useState('');
  const [outcome, setOutcome] = useState<Experience['outcome']>('info');
  const [hp, setHp] = useState('');
  const [state, setState] = useState<{ ok?: string; err?: string; busy?: boolean }>({});
  const canPost = Boolean(supabase && c.id);

  useEffect(() => {
    if (c.id) loadExperiences(c.id).then(setItems);
    else setItems([]);
  }, [c.id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !c.id || hp) return;
    const text = body.trim();
    if (text.length < 10) return setState({ err: 'Write at least a line or two (10+ characters).' });
    if (throttled(`exp:${c.id}`)) return setState({ err: 'Easy there — wait 30 seconds before posting again.' });
    setState({ busy: true });
    const { data, error } = await supabase
      .from('experiences')
      .insert({ company_id: c.id, body: text.slice(0, 2000), handle: handle.trim().slice(0, 40), outcome })
      .select()
      .single();
    if (error) return setState({ err: error.message });
    setItems((prev) => [data as Experience, ...(prev ?? [])]);
    setBody('');
    setState({ ok: 'Posted. Thanks for keeping it real.' });
    onPosted?.();
  }

  const ctc = ctcLabel(c);
  return (
    <Modal onClose={onClose} label={c.name}>
      <div className="eyebrow">{c.date_raw ? `Applied ${c.date_raw}` : 'Date not recorded'}</div>
      <h2>{c.name}</h2>
      {c.role && <p style={{ margin: '0 0 10px', color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{c.role}</p>}
      <TagList tags={c.tags} />

      <div className="kv">
        <div>
          <div className="k">CTC</div>
          <div className="v">{ctc ?? '—'}</div>
        </div>
        <div>
          <div className="k">Stipend</div>
          <div className="v">{c.stipendMax ? fmtStipend(c.stipendMax) : '—'}</div>
        </div>
        <div>
          <div className="k">Intake</div>
          <div className="v">{c.intakeLabel || '—'}</div>
        </div>
      </div>

      {c.ctc_raw && <Block k="As written in the sheet">{c.ctc_raw}</Block>}
      {c.rounds && <Block k="Rounds / status"><Linkify text={c.rounds} /></Block>}
      {c.details && <Block k="More details / eligibility"><Linkify text={c.details} /></Block>}
      {!c.hasInfo && <p className="note">Nobody has added details for this one yet. Went through it? Drop what you know below.</p>}

      {c.id && supabase && (
        <ProgressPanel
          counts={progress.counts}
          mine={progress.mine}
          canSet={progress.canSet}
          signedInWrong={progress.signedInWrong}
          onSet={onSetStage}
          onSignIn={() => signInWithCollegeGoogle('drives').catch((e) => setPErr(errText(e)))}
          busy={pBusy}
          err={pErr}
        />
      )}

      {supabase && (
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => { onClose(); setTimeout(() => openTeaChannel(c.name), 50); }}>
          Discuss in #{c.name.trim().toLowerCase()} on placemenTEA →
        </button>
      )}

      <h3>Unfiltered experiences {items && items.length > 0 && <span className="note">({items.length})</span>}</h3>
      {canPost ? (
        <form className="form" onSubmit={submit} style={{ marginBottom: 20 }}>
          <div className="chips" role="radiogroup" aria-label="How did it go?">
            {(Object.keys(OUTCOMES) as Experience['outcome'][]).map((o) => (
              <button type="button" key={o} className="chip" aria-pressed={outcome === o} onClick={() => setOutcome(o)}>
                {OUTCOMES[o]}
              </button>
            ))}
          </div>
          <label>
            What happened? OA questions, interview topics, timelines, red flags…
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="R1 was 2 DSA on hackerrank (graphs + DP), interview asked OS + DBMS basics, result mail came after 9 days…" />
          </label>
          <div className="two">
            <label>
              Handle (optional — stays anonymous if empty)
              <input value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={40} placeholder="e.g. ise_3rdyr" />
            </label>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn dark" disabled={state.busy} style={{ width: '100%' }}>
                {state.busy ? 'Posting…' : 'Post anonymously'}
              </button>
            </div>
          </div>
          <input className="hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} aria-hidden />
          {state.ok && <div className="ok">{state.ok}</div>}
          {state.err && <div className="err">{state.err}</div>}
          <p className="note">No names of students or recruiters, please. Posts that dox people get removed.</p>
        </form>
      ) : (
        <p className="note">Experiences open up once the live database is connected.</p>
      )}

      {items === null ? (
        <div className="skeleton" style={{ minHeight: 80 }} />
      ) : items.length === 0 ? (
        canPost && <p className="note">No experiences yet — be the first.</p>
      ) : (
        items.map((x) => (
          <div className="exp" key={x.id} style={{ marginBottom: 10 }}>
            <div className="who">
              <span>{x.handle || 'anonymous'} · {timeAgo(x.created_at)}</span>
              <span className={`outcome ${x.outcome}`}>{OUTCOMES[x.outcome]}</span>
            </div>
            <p>{x.body}</p>
          </div>
        ))
      )}
    </Modal>
  );
}
