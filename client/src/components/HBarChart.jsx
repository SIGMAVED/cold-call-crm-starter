import { useState } from 'react';

// Horizontal bar chart comparing magnitude across nominal categories — one
// hue for every bar (color never re-encodes what bar length already shows).
// The value sits at the tip so the number is visible without hovering;
// the tooltip only adds the hover-lift affordance on top.
export default function HBarChart({ data }) {
  const [active, setActive] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  if (data.length === 0) return <div className="empty-state">No data yet.</div>;

  return (
    <div className="chart-bars-h">
      {data.map((d, i) => (
        <div
          key={i}
          className={`chart-bar-h-row${active === i ? ' is-active' : ''}`}
          tabIndex={0}
          onMouseEnter={() => setActive(i)}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(i)}
          onBlur={() => setActive(null)}
        >
          <div className="chart-bar-h-label">{d.label}</div>
          <div className="chart-bar-h-track">
            <div className="chart-bar-h-fill" style={{ width: `${Math.max(1, (d.value / max) * 100)}%` }} />
          </div>
          <div className="chart-bar-h-value">{d.value}</div>
        </div>
      ))}
    </div>
  );
}
