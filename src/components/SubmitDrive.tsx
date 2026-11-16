import { useState, type FormEvent } from 'react';
import { supabase, SHEET_URL } from '../lib/supabase';
import { throttled } from '../lib/data';
import { Modal } from './ui';

const empty = { name: '', date_raw: '', role: '', ctc_raw: '', intake_raw: '', details: '' };

export function SubmitDrive({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState(empty);
  const [hp, setHp] = useState('');
  const [state, setState] = useState<{ ok?: boolean; err?: string; busy?: boolean }>({});
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (hp || !supabase) return;
    if (!f.name.trim()) return setState({ err: 'Company name is required.' });
    if (throttled('submit', 20_000)) return setState({ err: 'Give it 20 seconds between submissions.' });
    setState({ busy: true });
    const { error } = await supabase.from('submissions').insert({
      name: f.name.trim().slice(0, 120),
      date_raw: f.date_raw.trim().slice(0, 40),
      role: f.role.trim().slice(0, 300),
      ctc_raw: f.ctc_raw.trim().slice(0, 200),
      intake_raw: f.intake_raw.trim().slice(0, 60),
      details: f.details.trim().slice(0, 3000),
    });
    if (error) return setState({ err: error.message });
    setState({ ok: true });
    setF(empty);
  }

  return (
    <Modal onClose={onClose} center label="Add a drive">
      <div className="eyebrow">New company on campus?</div>
      <h2>Drop the drive</h2>
      <p className="note" style={{ marginTop: 0 }}>Goes to a review queue first so the list doesn't fill with spam. Write it how you'd write it in the group chat.</p>
      {!supabase ? (
        <p className="note">
          Submissions turn on once the database is connected. Until then, add it straight to the{' '}
          <a href={SHEET_URL} target="_blank" rel="noreferrer">community sheet</a>.
        </p>
      ) : state.ok ? (
        <>
          <div className="ok">Got it — it'll show up once a maintainer checks it. 🙏</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn dark" onClick={() => setState({})}>Add another</button>
            <button className="btn" onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <form className="form" onSubmit={submit}>
          <div className="two">
            <label>Company *<input value={f.name} onChange={set('name')} maxLength={120} required placeholder="e.g. Wayfair" /></label>
            <label>Application date<input value={f.date_raw} onChange={set('date_raw')} maxLength={40} placeholder="dd/mm/yyyy" /></label>
          </div>
          <label>Role(s)<input value={f.role} onChange={set('role')} maxLength={300} placeholder="SDE, Data Engineer…" /></label>
          <div className="two">
            <label>Stipend / CTC<input value={f.ctc_raw} onChange={set('ctc_raw')} maxLength={200} placeholder="40k // 14lpa, bond 2 yrs" /></label>
            <label>Intake<input value={f.intake_raw} onChange={set('intake_raw')} maxLength={60} placeholder="5" /></label>
          </div>
          <label>Rounds, eligibility, anything else<textarea value={f.details} onChange={set('details')} maxLength={3000} placeholder="OA (2 DSA + apti) → tech → HR. 7.5 CGPA cutoff, CSE/ISE only." /></label>
          <input className="hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} aria-hidden />
          {state.err && <div className="err">{state.err}</div>}
          <button className="btn dark" disabled={state.busy}>{state.busy ? 'Sending…' : 'Submit for review'}</button>
        </form>
      )}
    </Modal>
  );
}
