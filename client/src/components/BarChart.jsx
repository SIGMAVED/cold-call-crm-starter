import { useState } from 'react';

// Vertical bar chart for a single time-ordered series (one hue — magnitude
// is carried entirely by bar height, never by color). Tooltip and keyboard
// focus show the same value; the visible axis labels keep the numbers
// reachable without hovering at all.
export default function BarChart({ data, unitLabel = 'dials' }) {
  const [active, setActive] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  if (data.length === 0) return <div className="empty-state">No data yet.</div>;

  return (
    <div className="chart-bars-v-wrap">
      <div className="chart-bars-v">
        {data.map((d, i) => (
          <div
            key={i}
            className="chart-bar-v-col"
            tabIndex={0}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            {active === i && (
              <div className="chart-tooltip">
                <strong>{d.value}</strong> {unitLabel}
                <div className="chart-tooltip-sub">{d.fullLabel || d.label}</div>
              </div>
            )}
            <div
              className={`chart-bar-v${active === i ? ' is-active' : ''}`}
              style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="chart-bars-v-axis">
        {data.map((d, i) => (
          <div key={i} className="chart-bar-v-col">
            <span className="chart-bar-v-label">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
