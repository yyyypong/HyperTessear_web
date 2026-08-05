import { useMemo, useRef, useState } from 'react';
import { isoDate } from '../lib/format';

const VB_W = 720;
const VB_H = 240;
const PAD = { top: 16, right: 14, bottom: 26, left: 64 };

/**
 * Generic time-series area chart over [{date, value}].
 *
 * Used by both the product NAV chart and the protocol TVL chart on
 * /transparency. Hand-rolled SVG rather than a charting library: two
 * charts of the same shape do not justify ~150KB of Recharts. A third
 * chart *type* would.
 */
export default function TimeSeriesChart({
  data,
  label,
  formatValue = (v) => String(v),
  formatAxis = (v) => String(v),
  ranges = [{ label: '30D', days: 30 }, { label: '90D', days: 90 }, { label: 'All', days: 'all' }],
  defaultRangeIndex = 1,
  subLabel,
  tooltipLabel = 'Value',
}) {
  const [rangeIdx, setRangeIdx] = useState(defaultRangeIndex);
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const range = ranges[rangeIdx]?.days ?? 'all';

  const points = useMemo(() => {
    if (!data?.length) return [];
    return range === 'all' ? data : data.slice(-range);
  }, [data, range]);

  const geom = useMemo(() => {
    if (points.length < 2) return null;

    const values = points.map(p => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = (max - min) || Math.abs(max) * 0.01 || 1;
    // Don't pad below zero for series that can't be negative — a TVL
    // axis labelled "-$1.31M" is worse than a slightly tighter domain.
    const rawLo = min - span * 0.15;
    const lo = min >= 0 ? Math.max(0, rawLo) : rawLo;
    const hi = max + span * 0.15;

    const plotW = VB_W - PAD.left - PAD.right;
    const plotH = VB_H - PAD.top - PAD.bottom;

    const x = (i) => PAD.left + (i / (points.length - 1)) * plotW;
    const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;

    const line = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`)
      .join(' ');
    const base = (VB_H - PAD.bottom).toFixed(2);
    const area = `${line} L${x(points.length - 1).toFixed(2)},${base} L${x(0).toFixed(2)},${base} Z`;

    const ticks = [0, 1, 2, 3].map(k => {
      const v = lo + ((hi - lo) * k) / 3;
      return { v, y: y(v) };
    });

    return { x, y, line, area, ticks, plotW };
  }, [points]);

  if (!geom) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const changePct = first.value === 0 ? 0 : ((last.value - first.value) / Math.abs(first.value)) * 100;
  const up = changePct >= 0;

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;   // 0..1 across the rendered svg
    const vbX = ratio * VB_W;                              // back into viewBox units
    const idx = Math.round(((vbX - PAD.left) / geom.plotW) * (points.length - 1));
    if (idx < 0 || idx >= points.length) { setHover(null); return; }
    setHover({ idx, leftPct: (geom.x(idx) / VB_W) * 100 });
  };

  const hp = hover ? points[hover.idx] : null;
  const gradientId = `tsfill-${label?.replace(/\W/g, '') || 'x'}`;

  return (
    <>
      <div className="chart__head">
        <div>
          <div className="dstat__label">{label}</div>
          <div className="chart__now">
            {formatValue(last.value)}
            <span className={`chart__delta chart__delta--${up ? 'up' : 'down'}`}>
              {up ? '+' : ''}{changePct.toFixed(2)}%
            </span>
          </div>
          {subLabel && <div className="dstat__sub">{subLabel(first, last)}</div>}
        </div>

        <div className="chart__range">
          {ranges.map((r, i) => (
            <button key={r.label} onClick={() => setRangeIdx(i)} aria-pressed={rangeIdx === i}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart__wrap">
        {hp && (
          <div className="chart__tip" style={{ left: `${hover.leftPct}%`, top: 8 }}>
            <div>{isoDate(hp.date)}</div>
            <div>{tooltipLabel} <b>{formatValue(hp.value)}</b></div>
          </div>
        )}

        <svg
          ref={svgRef}
          className="chart__svg"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          role="img"
          aria-label={label}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--gold)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {geom.ticks.map((tk, i) => (
            <g key={i}>
              <line className="chart__grid" x1={PAD.left} y1={tk.y} x2={VB_W - PAD.right} y2={tk.y} />
              <text className="chart__axis" x={PAD.left - 8} y={tk.y + 3} textAnchor="end">
                {formatAxis(tk.v)}
              </text>
            </g>
          ))}

          <path d={geom.area} fill={`url(#${gradientId})`} />
          <path d={geom.line} fill="none" stroke="var(--gold)" strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" />

          {hp && (
            <g>
              <line className="chart__hover-line"
                x1={geom.x(hover.idx)} y1={PAD.top}
                x2={geom.x(hover.idx)} y2={VB_H - PAD.bottom} />
              <circle cx={geom.x(hover.idx)} cy={geom.y(hp.value)} r="4"
                fill="#fff" stroke="var(--gold)" strokeWidth="2" />
            </g>
          )}

          <text className="chart__axis" x={PAD.left} y={VB_H - 8}>{isoDate(first.date)}</text>
          <text className="chart__axis" x={VB_W - PAD.right} y={VB_H - 8} textAnchor="end">
            {isoDate(last.date)}
          </text>
        </svg>
      </div>
    </>
  );
}
