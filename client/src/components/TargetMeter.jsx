import { TrendingUp, AlertTriangle, TrendingDown } from 'lucide-react';

const PACE = {
  on_pace: { color: 'var(--green)', soft: 'var(--green-soft)', badge: 'badge-success', label: 'On pace', Icon: TrendingUp },
  at_risk: { color: 'var(--orange)', soft: 'var(--orange-soft)', badge: 'badge-warn', label: 'At risk', Icon: AlertTriangle },
  behind: { color: 'var(--red)', soft: 'var(--red-soft)', badge: 'badge-danger', label: 'Behind pace', Icon: TrendingDown },
};

export default function TargetMeter({ target }) {
  if (!target) return null;
  const meta = PACE[target.paceStatus] || PACE.on_pace;
  const pct = Math.min(100, Math.max(0, target.percent));

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="progress-label" style={{ marginBottom: 6 }}>{target.label}</div>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>
            {target.progressCount.toLocaleString()}
            <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-dim)' }}> / {target.target_count.toLocaleString()} {target.unit}</span>
          </div>
        </div>
        {/* An open-ended target has no deadline, so there's no pace to be on or
            behind — showing "On pace" there would be meaningless. */}
        {target.phase === 'active' && !target.openEnded && (
          <span className={`badge ${meta.badge}`}><meta.Icon size={13} />{meta.label}</span>
        )}
        {target.phase === 'active' && target.openEnded && (
          <span className="badge badge-neutral">No deadline</span>
        )}
        {target.phase === 'upcoming' && <span className="badge badge-info">Starts {target.start_date}</span>}
        {target.phase === 'ended' && <span className="badge badge-neutral">Ended {target.end_date}</span>}
      </div>

      <div style={{ height: 12, borderRadius: 999, background: meta.soft, overflow: 'hidden', margin: '16px 0 10px' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: meta.color, borderRadius: 999, transition: 'width 0.4s var(--ease)' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-dim)' }}>
        <span>{target.percent}% complete</span>
        {target.phase === 'active' && target.openEnded && (
          <span>{Math.max(0, target.target_count - target.progressCount)} {target.unit} to go</span>
        )}
        {target.phase === 'active' && !target.openEnded && target.perDayNeeded !== null && (
          <span>{target.perDayNeeded} {target.unit}/day needed · {target.daysLeft} day{target.daysLeft === 1 ? '' : 's'} left</span>
        )}
      </div>
    </div>
  );
}
