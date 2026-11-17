import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { countdown, isActive, localDate, nextEvent, type Upcoming } from '../lib/data';
import { Modal } from './ui';

export type UpcomingDraft = Partial<Upcoming> & { name: string };

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO timestamp → value for <input type="datetime-local"> in the admin's local time */
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function UpcomingTab({ items, onEdit, onChanged }: { items: Upcoming[]; onEdit: (u: UpcomingDraft) => void; onChanged: () => void }) {
  const now = Date.now();
  const sorted = [...items].sort((a, b) => {
    const pa = isActive(a, now) ? 0 : 1;
    const pb = isActive(b, now) ? 0 : 1;
    return pa - pb || nextEvent(a, now).at - nextEvent(b, now).at;
  });

  async function remove(u: Upcoming) {
    if (!confirm(`Delete upcoming drive "${u.name}"?`)) return;
    await supabase!.from('upcoming_drives').delete().eq('id', u.id);
    onChanged();
  }

  async function moveToDrives(u: Upcoming) {
    if (!confirm(`Move "${u.name}" into Every drive? It will be removed from Upcoming.`)) return;
    const d = u.drive_date ? localDate(u.drive_date) : u.deadline ? new Date(u.deadline) : null;
    const date_raw = d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '';
    const details = [u.eligibility && `Eligibility: ${u.eligibility}`, u.notes].filter(Boolean).join('\n');
    const { error } = await supabase!.from('companies').insert({
      name: u.name, date_raw, role: u.role, ctc_raw: u.ctc_raw, rounds: '', details, source: 'manual',
    });
    if (error) return alert(error.message);
    await supabase!.from('upcoming_drives').delete().eq('id', u.id);
    onChanged();
  }

  return (
    <div className="panel">
      <div className="controls-row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <p className="desc" style={{ margin: 0 }}>
          Shown on the home page until the deadline and drive day have passed. After the drive, use <b>Move to drives</b>.
        </p>
        <button className="btn dark" onClick={() => onEdit({ name: '' })}>+ New upcoming drive</button>
      </div>
      {sorted.length === 0 && <p className="note">Nothing here yet.</p>}
      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <tbody>
            {sorted.map((u) => {
              const live = isActive(u, now);
              return (
                <tr key={u.id} style={{ opacity: live ? 1 : 0.6 }}>
                  <td>
                    <b>{u.name}</b>
                    <div className="note">{[u.role, u.ctc_raw].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>{live ? countdown(u, now).text : <span className="tag">past · hidden</span>}</td>
                  <td>
                    <div className="admin-actions">
                      <button className="btn sm" onClick={() => onEdit(u)}>Edit</button>
                      <button className="btn sm" onClick={() => moveToDrives(u)}>Move to drives</button>
                      <button className="btn sm ghost" onClick={() => remove(u)}>Delete</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function UpcomingEditor({ draft, onClose, onSaved }: { draft: UpcomingDraft; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: draft.name ?? '',
    role: draft.role ?? '',
    ctc_raw: draft.ctc_raw ?? '',
    eligibility: draft.eligibility ?? '',
    drive_date: draft.drive_date ?? '',
    deadline: toLocalInput(draft.deadline),
    apply_link: draft.apply_link ?? '',
    notes: draft.notes ?? '',
  });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    const link = f.apply_link.trim();
    if (link && !/^https?:\/\//i.test(link)) return setErr('Apply link must start with http:// or https://');
    const payload = {
      name: f.name.trim(),
      role: f.role.trim(),
      ctc_raw: f.ctc_raw.trim(),
      eligibility: f.eligibility.trim(),
      drive_date: f.drive_date || null,
      deadline: f.deadline ? new Date(f.deadline).toISOString() : null,
      apply_link: link,
      notes: f.notes.trim(),
    };
    const { error } = draft.id
      ? await supabase!.from('upcoming_drives').update(payload).eq('id', draft.id)
      : await supabase!.from('upcoming_drives').insert(payload);
    if (error) return setErr(error.message);
    onSaved();
  }

  return (
    <Modal onClose={onClose} center label="Upcoming drive">
      <h2>{draft.id ? 'Edit upcoming drive' : 'New upcoming drive'}</h2>
      <form className="form" onSubmit={save}>
        <label>Company *<input value={f.name} onChange={set('name')} required maxLength={120} /></label>
        <div className="two">
          <label>Role(s)<input value={f.role} onChange={set('role')} maxLength={300} placeholder="SDE, Data Engineer" /></label>
          <label>Stipend / CTC<input value={f.ctc_raw} onChange={set('ctc_raw')} maxLength={200} placeholder="40k // 14lpa" /></label>
        </div>
        <div className="two">
          <label>Registration deadline<input type="datetime-local" value={f.deadline} onChange={set('deadline')} /></label>
          <label>Drive / test date<input type="date" value={f.drive_date} onChange={set('drive_date')} /></label>
        </div>
        <label>Eligibility<input value={f.eligibility} onChange={set('eligibility')} maxLength={1000} placeholder="CSE/ISE/AIML · 7.5 CGPA · no backlogs" /></label>
        <label>Apply / registration link<input type="url" value={f.apply_link} onChange={set('apply_link')} placeholder="https://forms.gle/…" /></label>
        <label>Notes (rounds, PPT time, venue…)<textarea value={f.notes} onChange={set('notes')} maxLength={3000} /></label>
        <p className="note" style={{ margin: 0 }}>Leave both dates empty to show it as "Date TBA".</p>
        {err && <div className="err">{err}</div>}
        <button className="btn dark">Save</button>
      </form>
    </Modal>
  );
}
