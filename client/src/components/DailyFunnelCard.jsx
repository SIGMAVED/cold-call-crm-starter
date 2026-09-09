import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

// Today's four numbers. Presentations is rendered dominant on purpose: it's
// the measured bottleneck, and the whole point of tracking the funnel is to
// keep the eye on the stage that actually needs to move.
const STAGES = [
  { key: 'dials', label: 'Dials' },
  { key: 'owners', label: 'Owners' },
  { key: 'presentations', label: 'Presentations', hero: true },
  { key: 'appointments', label: 'Appointments' },
];

export default function DailyFunnelCard() {
  const [m, setM] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => api.metricsToday().then((d) => { if (!cancelled) setM(d); }).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Today</h2>
        <Link to="/funnel" style={{ fontSize: 12.5 }}>Full funnel →</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, alignItems: 'end' }}>
        {STAGES.map(({ key, label, hero }) => {
          const done = m?.counts?.[key] ?? 0;
          const goal = m?.goals?.[key] ?? 0;
          const pctv = goal ? Math.min(100, (done / goal) * 100) : 0;
          const hit = goal && done >= goal;
          return (
            <div
              key={key}
              style={hero ? {
                padding: '12px 14px', borderRadius: 10,
                background: 'var(--accent-soft)', border: '1px solid var(--accent)',
              } : { padding: '12px 2px' }}
            >
              <div style={{
                fontSize: hero ? 40 : 24, fontWeight: 800, lineHeight: 1.1,
                letterSpacing: '-0.02em',
                color: hit ? 'var(--green)' : hero ? 'var(--accent)' : 'var(--text)',
              }}>
                {m ? done : '—'}
                <span style={{ fontSize: hero ? 17 : 13, fontWeight: 500, color: 'var(--text-dim)' }}> / {goal}</span>
              </div>
              <div style={{
                fontSize: hero ? 12.5 : 11.5, fontWeight: hero ? 700 : 600,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                color: hero ? 'var(--accent)' : 'var(--text-dim)', marginTop: 2,
              }}>
                {label}
              </div>
              <div style={{ height: hero ? 6 : 4, borderRadius: 999, background: 'var(--bg-elev-2)', marginTop: 7, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${pctv}%`, borderRadius: 999,
                  background: hit ? 'var(--green)' : hero ? 'var(--accent)' : 'var(--text-faint)',
                  transition: 'width 0.4s var(--ease)',
                }} />
              </div>
              {hero && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
                  full pitch + explicit ask — the one that needs to move
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
