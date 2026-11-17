import { useEffect, useMemo, useState } from 'react';
import { calendarLink, countdown, isActive, localDate, nextEvent, type Upcoming as U } from '../lib/data';
import { openTeaChannel } from './Tea';
import { supabase } from '../lib/supabase';
import { fmtLpa, fmtStipend, parseMoney } from '../lib/parse';
import { Icon } from './ui';

function money(raw: string) {
  const { ctcMin, ctcMax, stipendMax } = parseMoney(raw);
  const ctc = ctcMax == null ? null : ctcMin != null && ctcMin !== ctcMax ? `${ctcMin}–${fmtLpa(ctcMax)}` : fmtLpa(ctcMax);
  const parts = [ctc, stipendMax ? `${fmtStipend(stipendMax)}${ctc ? ' stipend' : ''}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : raw || null;
}

function DateTile({ u }: { u: U }) {
  const d = u.drive_date ? localDate(u.drive_date) : u.deadline ? new Date(u.deadline) : null;
  if (!d) return <div className="up-date tba"><span className="day">TBA</span></div>;
  return (
    <div className="up-date">
      <span className="mon">{d.toLocaleDateString('en-IN', { month: 'short' })}</span>
      <span className="day">{d.getDate()}</span>
      <span className="dow">{d.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
    </div>
  );
}

export function Upcoming({ items, onSubmit }: { items: U[] | null; onSubmit: () => void }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const list = useMemo(
    () => (items ?? []).filter((u) => isActive(u, now)).sort((a, b) => nextEvent(a, now).at - nextEvent(b, now).at),
    [items, now]
  );

  if (items === null) return <div className="up-grid"><div className="skeleton" style={{ minHeight: 160 }} /></div>;

  if (!list.length)
    return (
      <div className="up-empty">
        <div>
          <b>Nothing announced right now.</b>
          <span> New drives show up here as soon as the mail drops.</span>
        </div>
        <button className="btn" onClick={onSubmit}>Heard about one? Add it</button>
      </div>
    );

  return (
    <div className="up-grid">
      {list.map((u) => {
        const cd = countdown(u, now);
        const pay = money(u.ctc_raw);
        const cal = calendarLink(u);
        return (
          <article className="up-card" key={u.id}>
            <DateTile u={u} />
            <div className="up-body">
              <span className={`up-chip${cd.urgent ? ' urgent' : ''}`}>
                <Icon name="calendar" size={14} />
                {cd.text}
              </span>
              <h3>{u.name}</h3>
              {u.role && <div className="up-role">{u.role}</div>}
              {pay && <div className="up-pay">{pay}</div>}
              <dl className="up-facts">
                {u.deadline && (
                  <>
                    <dt>Register by</dt>
                    <dd>{new Date(u.deadline).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</dd>
                  </>
                )}
                {u.eligibility && (
                  <>
                    <dt>Eligibility</dt>
                    <dd>{u.eligibility}</dd>
                  </>
                )}
              </dl>
              {u.notes && (
                <details className="up-notes">
                  <summary>More details</summary>
                  <p>{u.notes}</p>
                </details>
              )}
              <div className="up-actions">
                {u.apply_link && (
                  <a className="btn dark sm" href={u.apply_link} target="_blank" rel="noreferrer noopener nofollow">
                    Register / apply <Icon name="arrow" size={14} />
                  </a>
                )}
                {cal && (
                  <a className="btn sm ghost" href={cal} target="_blank" rel="noreferrer noopener">
                    Add to calendar
                  </a>
                )}
                {supabase && (
                  <button className="btn sm ghost" onClick={() => openTeaChannel(u.name)}>#{u.name.trim().toLowerCase()}</button>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
