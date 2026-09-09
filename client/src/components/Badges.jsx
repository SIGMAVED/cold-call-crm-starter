import { useSettings } from '../SettingsContext.jsx';

export function PriorityBadge({ priority }) {
  const cls = { Hot: 'badge-hot', Warm: 'badge-warm', Cold: 'badge-cold' }[priority] || 'badge-warm';
  return <span className={`badge ${cls}`}><span className="badge-dot" />{priority}</span>;
}

export function StatusBadge({ status }) {
  const { statuses } = useSettings();
  const cls = statuses.find((s) => s.name === status)?.color || 'badge-neutral';
  return <span className={`badge ${cls}`}>{status}</span>;
}
