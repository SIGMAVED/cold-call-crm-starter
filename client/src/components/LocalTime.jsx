import { Clock } from 'lucide-react';

// What o'clock it is where the business actually is. With leads spread across
// three US time zones and the calling done from IST, the colour is the point:
// it answers "should I be dialling this one right now" at a glance.
const STATUS_META = {
  good: { color: 'var(--green)', label: 'Good time to call' },
  early: { color: 'var(--orange)', label: 'Early — they may not be in yet' },
  late: { color: 'var(--orange)', label: 'Late — decision-maker may have left' },
  closed: { color: 'var(--red)', label: 'Outside calling hours / closed today' },
};

export default function LocalTime({ local, showIcon = true, size = 13 }) {
  if (!local) return <span style={{ color: 'var(--text-faint)' }}>—</span>;
  const meta = STATUS_META[local.status] || STATUS_META.closed;

  return (
    <span
      title={`${meta.label} · ${local.timeZone}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        color: meta.color, fontSize: size, fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >
      {showIcon && <Clock size={size - 1} />}
      {local.time}
    </span>
  );
}
