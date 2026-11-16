import { useState } from 'react';

export type Bar = { label: string; value: number; tip?: string; highlight?: boolean };

/** Single-series column chart: thin rounded bars, recessive grid, hover tooltip. */
export function BarChart({ data, height = 220, unit = 'drives' }: { data: Bar[]; height?: number; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const pad = { t: 24, r: 8, b: 28, l: 8 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const slot = iw / data.length;
  const bw = Math.min(44, slot * 0.56);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0.5, 1].map((f) => Math.round(max * f));

  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(', ')}>
        {ticks.map((t) => (
          <line key={t} className="grid-line" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
        ))}
        <line className="axis" x1={pad.l} x2={W - pad.r} y1={pad.t + ih} y2={pad.t + ih} />
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const h = Math.max(d.value ? 4 : 0, (d.value / max) * ih);
          const top = pad.t + ih - h;
          const r = Math.min(4, bw / 2, h);
          // rounded top only, flat on the baseline
          const path = h
            ? `M${cx - bw / 2},${pad.t + ih} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${pad.t + ih} Z`
            : '';
          return (
            <g key={d.label} className="col" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {path && <path className={`bar${d.highlight ? ' hl' : ''}`} d={path} />}
              <text className="val" x={cx} y={top - 7} textAnchor="middle">{d.value || ''}</text>
              <text x={cx} y={height - 8} textAnchor="middle">{d.label}</text>
              <rect className="hit" x={cx - slot / 2} y={pad.t - 10} width={slot} height={ih + 10} />
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: `${((pad.l + slot * hover + slot / 2) / W) * 100}%`, top: `${(y(data[hover].value) / height) * 100}%` }}>
          <b>{data[hover].value} {unit}</b>
          {data[hover].tip ?? data[hover].label}
        </div>
      )}
    </div>
  );
}
