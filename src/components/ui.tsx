import { useEffect, useRef, type ReactNode } from 'react';
import { TAGS, type TagKey } from '../lib/parse';

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden>
      <svg width="18" height="18" viewBox="0 0 32 32">
        <path d="M5 19c3-8 7-8 10-3s6 5 12-4" fill="none" stroke="#e3e2f7" strokeWidth="3.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Nav({ onSubmit, admin }: { onSubmit?: () => void; admin?: boolean }) {
  return (
    <nav className="nav" aria-label="Main">
      <a className="brand" href="/">
        <BrandMark />
        <span>
          PLACEMENTS '27
          <small>BMSIT · unofficial</small>
        </span>
      </a>
      {!admin && (
        <div className="nav-links">
          <a href="#drives">Drives</a>
          <a href="#insights">Insights</a>
          <a href="#experiences">Experiences</a>
          <a href="#tea">placemenTEA</a>
        </div>
      )}
      {onSubmit && (
        <button className="btn" onClick={onSubmit}>
          Add a drive
        </button>
      )}
      {admin && (
        <a className="btn" href="/">
          View site
        </a>
      )}
    </nav>
  );
}

export function TagList({ tags, max }: { tags: TagKey[]; max?: number }) {
  const shown = max ? tags.slice(0, max) : tags;
  return (
    <span className="tags">
      {shown.map((t) => (
        <span key={t} className={`tag ${TAGS[t].tone}`} title={TAGS[t].hint}>
          {TAGS[t].label}
        </span>
      ))}
      {max && tags.length > max && <span className="tag">+{tags.length - max}</span>}
    </span>
  );
}

export function Modal({ onClose, children, center, label }: { onClose: () => void; children: ReactNode; center?: boolean; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className={`overlay${center ? ' center' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet${center ? ' center' : ''}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
        <button className="close" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
        {children}
      </div>
    </div>
  );
}

/** Hand-drawn style loop, like a pen scribble across the panel. */
export function Squiggle({ style, width = 900 }: { style?: React.CSSProperties; width?: number }) {
  return (
    <svg className="squiggle" style={style} width={width} viewBox="0 0 900 260" aria-hidden>
      <path d="M-20 200 C 80 40, 160 30, 190 120 S 150 250, 230 210 S 330 40, 380 110 S 420 230, 520 170 S 640 30, 700 120 S 760 240, 940 90" />
    </svg>
  );
}

export function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => en.isIntersecting && (en.target.classList.add('in'), io.unobserve(en.target))),
      { rootMargin: '0px 0px -60px 0px' }
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  });
}

type IconName = 'x' | 'search' | 'zap' | 'eye' | 'users' | 'send' | 'sheet' | 'git' | 'grid' | 'list' | 'chat' | 'calendar' | 'arrow';
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'x': return <svg {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    case 'search': return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
    case 'zap': return <svg {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>;
    case 'eye': return <svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'users': return <svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 010 7M18.5 14.8c1.6.8 2.6 2.6 3 5.2" /></svg>;
    case 'send': return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 6.5l8.5 6.5 8.5-6.5" /></svg>;
    case 'sheet': return <svg {...p}><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M4 9h16M4 15h16M10 3v18" /></svg>;
    case 'git': return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M14.8 9.2l-2 5.6-5.6 2 2-5.6z" /></svg>;
    case 'grid': return <svg {...p}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>;
    case 'list': return <svg {...p}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>;
    case 'chat': return <svg {...p}><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" /></svg>;
    case 'calendar': return <svg {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>;
    case 'arrow': return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
  }
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
