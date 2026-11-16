import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, SHEET_URL } from './lib/supabase';
import { fetchSheetRows, OUTCOMES, type Experience, type Submission } from './lib/data';
import type { CompanyRow } from './lib/parse';
import { Modal, Nav, timeAgo } from './components/ui';

type Tab = 'drives' | 'submissions' | 'experiences' | 'sync';
const blank: CompanyRow = { name: '', date_raw: '', role: '', ctc_raw: '', intake_raw: '', rounds: '', details: '', position: 0 };

export default function Admin() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) return setIsAdmin(null);
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(Boolean(data)));
  }, [session]);

  return (
    <div className="wrap">
      <div className="frame">
        <Nav admin />
        <div className="inner" style={{ paddingTop: 8 }}>
          {!supabase ? (
            <p>Supabase isn't configured for this build. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then redeploy.</p>
          ) : !session ? (
            <Login />
          ) : isAdmin === null ? (
            <p className="note">Checking access…</p>
          ) : !isAdmin ? (
            <div>
              <p>Signed in as <b>{session.user.email}</b>, but this account isn't an admin.</p>
              <p className="note">Add it in Supabase SQL: <code>insert into public.admins (email) values ('{session.user.email}');</code></p>
              <button className="btn" onClick={() => supabase!.auth.signOut()}>Sign out</button>
            </div>
          ) : (
            <Dashboard email={session.user.email ?? ''} />
          )}
        </div>
      </div>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase!.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
  }
  return (
    <form className="form" onSubmit={submit} style={{ maxWidth: 380 }}>
      <h2 className="h2" style={{ fontSize: 40 }}>Admin</h2>
      <p className="note" style={{ margin: 0 }}>Maintainers only. Accounts are created in Supabase → Authentication.</p>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
      {err && <div className="err">{err}</div>}
      <button className="btn dark" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

function Dashboard({ email }: { email: string }) {
  const [tab, setTab] = useState<Tab>('drives');
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [exps, setExps] = useState<Experience[]>([]);
  const [editing, setEditing] = useState<CompanyRow | null>(null);
  const [fromSub, setFromSub] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const reload = useCallback(async () => {
    const sb = supabase!;
    const [c, s, x] = await Promise.all([
      sb.from('companies').select('*').order('position', { ascending: false }),
      sb.from('submissions').select('*').order('created_at', { ascending: false }).limit(200),
      sb.from('experiences').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    setCompanies((c.data ?? []) as CompanyRow[]);
    setSubs((s.data ?? []) as Submission[]);
    setExps((x.data ?? []) as Experience[]);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const names = new Map(companies.map((c) => [c.id, c.name]));
  const pending = subs.filter((s) => s.status === 'pending');

  async function remove(c: CompanyRow) {
    if (!confirm(`Delete ${c.name}? Its experiences go too.`)) return;
    await supabase!.from('companies').delete().eq('id', c.id!);
    reload();
  }
  async function setSubStatus(id: string, status: Submission['status']) {
    await supabase!.from('submissions').update({ status }).eq('id', id);
    reload();
  }
  async function delExp(id: string) {
    if (!confirm('Delete this experience?')) return;
    await supabase!.from('experiences').delete().eq('id', id);
    reload();
  }

  const shown = companies.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="section-head" style={{ marginBottom: 20 }}>
        <h2 className="h2" style={{ fontSize: 40 }}>Admin</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="note">{email}</span>
          <button className="btn sm" onClick={() => supabase!.auth.signOut()}>Sign out</button>
        </div>
      </div>
      <div className="seg" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
        <button aria-pressed={tab === 'drives'} onClick={() => setTab('drives')}>Drives ({companies.length})</button>
        <button aria-pressed={tab === 'submissions'} onClick={() => setTab('submissions')}>Submissions ({pending.length})</button>
        <button aria-pressed={tab === 'experiences'} onClick={() => setTab('experiences')}>Experiences ({exps.length})</button>
        <button aria-pressed={tab === 'sync'} onClick={() => setTab('sync')}>Sync sheet</button>
      </div>

      {tab === 'drives' && (
        <div className="panel">
          <div className="controls-row" style={{ marginBottom: 12 }}>
            <label className="search" style={{ background: 'var(--paper)' }}><input placeholder="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <button className="btn dark" onClick={() => { setFromSub(null); setEditing({ ...blank }); }}>+ New drive</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead><tr><th>Name</th><th>Date</th><th>CTC</th><th>Source</th><th /></tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b><div className="note">{c.role.slice(0, 60)}</div></td>
                    <td>{c.date_raw || '—'}</td>
                    <td>{c.ctc_raw.slice(0, 40) || '—'}</td>
                    <td><span className="tag">{c.source}</span></td>
                    <td><div className="admin-actions">
                      <button className="btn sm" onClick={() => { setFromSub(null); setEditing(c); }}>Edit</button>
                      <button className="btn sm ghost" onClick={() => remove(c)}>Delete</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">Rows marked <b>sheet</b> are overwritten by the next sheet sync. To keep a hand edit, fix it in the sheet too.</p>
        </div>
      )}

      {tab === 'submissions' && (
        <div className="panel">
          {subs.length === 0 && <p className="note">No submissions yet.</p>}
          {subs.map((s) => (
            <div className="block" key={s.id} style={{ background: s.status === 'pending' ? 'var(--lav)' : 'var(--paper)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 18 }}>{s.name}</b>
                <span className="note">{s.status} · {timeAgo(s.created_at)}</span>
              </div>
              <div className="v" style={{ fontSize: 14, marginTop: 6 }}>
                {[s.date_raw && `Date: ${s.date_raw}`, s.role && `Role: ${s.role}`, s.ctc_raw && `CTC: ${s.ctc_raw}`, s.intake_raw && `Intake: ${s.intake_raw}`, s.details].filter(Boolean).join('\n')}
              </div>
              {s.status === 'pending' && (
                <div className="admin-actions" style={{ marginTop: 10 }}>
                  <button className="btn sm dark" onClick={() => {
                    setFromSub(s.id);
                    setEditing({ ...blank, name: s.name, date_raw: s.date_raw, role: s.role, ctc_raw: s.ctc_raw, intake_raw: s.intake_raw, details: s.details });
                  }}>Review &amp; publish</button>
                  <button className="btn sm ghost" onClick={() => setSubStatus(s.id, 'dismissed')}>Dismiss</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'experiences' && (
        <div className="panel">
          {exps.length === 0 && <p className="note">No experiences yet.</p>}
          {exps.map((x) => (
            <div className="block" key={x.id} style={{ background: 'var(--paper)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <b>{names.get(x.company_id) ?? '—'}</b>
                <span className="note">{x.handle || 'anonymous'} · {OUTCOMES[x.outcome]} · {timeAgo(x.created_at)}</span>
              </div>
              <div className="v" style={{ fontSize: 14, marginTop: 6 }}>{x.body}</div>
              <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => delExp(x.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'sync' && <Sync current={companies} onDone={reload} />}

      {editing && (
        <EditDrive
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            if (fromSub) await supabase!.from('submissions').update({ status: 'approved' }).eq('id', fromSub);
            setEditing(null);
            setFromSub(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function EditDrive({ row, onClose, onSaved }: { row: CompanyRow; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(row);
  const [err, setErr] = useState('');
  const set = (k: keyof CompanyRow) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save(e: FormEvent) {
    e.preventDefault();
    const payload = { name: f.name.trim(), date_raw: f.date_raw, role: f.role, ctc_raw: f.ctc_raw, intake_raw: f.intake_raw, rounds: f.rounds, details: f.details };
    const { error } = f.id
      ? await supabase!.from('companies').update(payload).eq('id', f.id)
      : await supabase!.from('companies').insert({ ...payload, source: 'manual' });
    if (error) return setErr(error.message);
    onSaved();
  }
  return (
    <Modal onClose={onClose} center label="Edit drive">
      <h2>{f.id ? 'Edit drive' : 'New drive'}</h2>
      <form className="form" onSubmit={save}>
        <div className="two">
          <label>Company *<input value={f.name} onChange={set('name')} required /></label>
          <label>Application date (dd/mm/yyyy)<input value={f.date_raw} onChange={set('date_raw')} /></label>
        </div>
        <label>Role title<input value={f.role} onChange={set('role')} /></label>
        <div className="two">
          <label>Stipend / CTC<input value={f.ctc_raw} onChange={set('ctc_raw')} /></label>
          <label>Intake<input value={f.intake_raw} onChange={set('intake_raw')} /></label>
        </div>
        <label>Details on rounds / status<textarea value={f.rounds} onChange={set('rounds')} /></label>
        <label>More details / eligibility<textarea value={f.details} onChange={set('details')} /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn dark">Save</button>
      </form>
    </Modal>
  );
}

function Sync({ current, onDone }: { current: CompanyRow[]; onDone: () => void }) {
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);
  const sheetNow = current.filter((c) => c.source === 'sheet');
  const key = (c: CompanyRow) => `${c.name.trim().toLowerCase()}|${c.ctc_raw}|${c.date_raw}|${c.rounds}|${c.details}|${c.role}|${c.intake_raw}`;
  const before = new Set(sheetNow.map(key));
  const changed = rows ? rows.filter((r) => !before.has(key(r))) : [];

  async function preview() {
    setBusy(true);
    setMsg({});
    try {
      setRows(await fetchSheetRows());
    } catch (e) {
      setMsg({ err: (e as Error).message });
    }
    setBusy(false);
  }
  async function apply() {
    if (!rows) return;
    setBusy(true);
    const { data, error } = await supabase!.rpc('sync_sheet', { rows });
    setBusy(false);
    if (error) return setMsg({ err: error.message });
    setMsg({ ok: `Synced ${data} rows from the sheet.` });
    setRows(null);
    onDone();
  }

  return (
    <div className="panel">
      <h3>Sync from the Google Sheet</h3>
      <p className="desc">
        Pulls the public <a href={SHEET_URL} target="_blank" rel="noreferrer">community sheet</a> and updates the {sheetNow.length} <b>sheet</b> rows
        in place (matched by company name + which occurrence it is), adds new ones and removes ones deleted from the sheet.
        Manual rows are never touched. Experiences stay attached unless a company is removed from the sheet.
      </p>
      <div className="admin-actions">
        <button className="btn" onClick={preview} disabled={busy}>{busy && !rows ? 'Fetching…' : 'Fetch & preview'}</button>
        {rows && <button className="btn dark" onClick={apply} disabled={busy}>Apply ({rows.length} rows in sheet)</button>}
      </div>
      {rows && (
        <div style={{ marginTop: 16 }}>
          <p className="note">{changed.length} new or changed rows:</p>
          <ul>{changed.slice(0, 50).map((r, i) => <li key={i}><b>{r.name}</b> — {r.ctc_raw || '—'}</li>)}</ul>
        </div>
      )}
      {msg.ok && <div className="ok">{msg.ok}</div>}
      {msg.err && <div className="err">{msg.err}</div>}
    </div>
  );
}
