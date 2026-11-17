import { STAGES, type Counts, type Stage } from '../lib/progress';

// ───────── applied → shortlisted → offer ─────────

export function FunnelMini({ c }: { c?: Counts }) {
  if (!c || !c.applied) return null;
  return (
    <span className="funnel-mini" title="Self-reported by students">
      {c.applied} applied · {c.shortlisted} shortlisted · <b>{c.offers} offer{c.offers === 1 ? '' : 's'}</b>
    </span>
  );
}

export function ProgressPanel({ counts, mine, canSet, signedInWrong, onSet, onSignIn, busy, err }: {
  counts?: Counts;
  mine?: Stage;
  canSet: boolean;
  signedInWrong: boolean;
  onSet: (s: Stage | null) => void;
  onSignIn: () => void;
  busy: boolean;
  err: string;
}) {
  const c = counts ?? { applied: 0, shortlisted: 0, offers: 0 };
  const max = Math.max(1, c.applied);
  const rows: [string, number][] = [['Applied', c.applied], ['Shortlisted', c.shortlisted], ['Got the offer', c.offers]];
  return (
    <div className="block progress">
      <div className="k">How the batch did · self-reported</div>
      <div className="funnel">
        {rows.map(([label, n]) => (
          <div className="funnel-row" key={label}>
            <span className="fl">{label}</span>
            <span className="fbar"><span style={{ width: `${(n / max) * 100}%` }} /></span>
            <span className="fn">{n}</span>
          </div>
        ))}
      </div>
      {canSet ? (
        <>
          <div className="k" style={{ marginTop: 14 }}>Your status (anonymous, only totals are shown)</div>
          <div className="chips">
            {STAGES.map((s) => (
              <button key={s.key} className="chip" aria-pressed={mine === s.key} disabled={busy} onClick={() => onSet(mine === s.key ? null : s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </>
      ) : signedInWrong ? (
        <p className="note" style={{ marginTop: 10 }}>Only @bmsit.in Google accounts can add their status.</p>
      ) : (
        <button className="btn sm" style={{ marginTop: 12 }} onClick={onSignIn}>Sign in with college Google to add yours</button>
      )}
      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}
