import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return toDateStr(d);
}

function todayStr() {
  return toDateStr(new Date());
}

function monthStart(monthsAgo = 0) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - monthsAgo, 1);
  return toDateStr(d);
}

function monthEnd(monthsAgo) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - monthsAgo + 1, 0);
  return toDateStr(d);
}

function shortDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Presets mirror the shape of an ad-platform date picker. Each preset is a
// function so "Today" etc. always resolve against the current date rather
// than going stale if this module stays loaded across a midnight rollover.
const PRESETS = [
  { key: 'today', label: 'Today', range: () => ({ from: todayStr(), to: todayStr() }) },
  { key: 'yesterday', label: 'Yesterday', range: () => ({ from: daysAgo(1), to: daysAgo(1) }) },
  { key: 'last7', label: 'Last 7 Days', range: () => ({ from: daysAgo(6), to: todayStr() }) },
  { key: 'last30', label: 'Last 30 Days', range: () => ({ from: daysAgo(29), to: todayStr() }) },
  { key: 'thisMonth', label: 'This Month', range: () => ({ from: monthStart(0), to: todayStr() }) },
  { key: 'lastMonth', label: 'Last Month', range: () => ({ from: monthStart(1), to: monthEnd(1) }) },
  { key: 'allTime', label: 'All Time', range: () => ({ from: '1970-01-01', to: todayStr() }) },
  // Tracking window for the 100 Website Pitch owner conversations target.
  { key: 'target', label: 'Website Pitch (Aug 13 onwards)', range: () => ({ from: '2026-08-13', to: todayStr() }) },
  // Fixed window for the "close a client by Aug 15" challenge.
  { key: 'challenge', label: 'Challenge (Jul 8–Aug 15)', range: () => ({ from: '2026-07-08', to: '2026-08-15' }) },
];

function currentLabel(value) {
  const match = PRESETS.find((p) => {
    const r = p.range();
    return r.from === value?.from && r.to === value?.to;
  });
  if (match) return match.label;
  if (value?.from && value?.to) return `${shortDate(value.from)} – ${shortDate(value.to)}`;
  return 'Select range';
}

export default function DateRangePicker({ value, onChange, noMargin }) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState('target');
  const [customFrom, setCustomFrom] = useState(value?.from || daysAgo(29));
  const [customTo, setCustomTo] = useState(value?.to || todayStr());
  const wrapRef = useRef(null);

  // Close on an outside click, same pattern as the Leads column picker.
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function pick(key) {
    setPreset(key);
    if (key === 'custom') {
      onChange({ from: customFrom, to: customTo });
      return;
    }
    onChange(PRESETS.find((p) => p.key === key).range());
    setOpen(false);
  }

  function applyCustom(from, to) {
    setCustomFrom(from);
    setCustomTo(to);
    if (from && to) onChange({ from, to });
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', marginBottom: noMargin ? 0 : 18 }}>
      <button className="btn" onClick={() => setOpen((o) => !o)} title="Choose the date range">
        <Calendar size={14} /> {currentLabel(value)} <ChevronDown size={14} />
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 100,
            width: 260, padding: 8,
          }}
        >
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => pick(p.key)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: preset === p.key ? 'var(--accent-soft)' : 'transparent',
                border: 'none', padding: '7px 9px', borderRadius: 8, fontSize: 13,
                color: preset === p.key ? 'var(--accent)' : 'var(--text)',
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => pick('custom')}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: preset === 'custom' ? 'var(--accent-soft)' : 'transparent',
              border: 'none', padding: '7px 9px', borderRadius: 8, fontSize: 13,
              color: preset === 'custom' ? 'var(--accent)' : 'var(--text)',
            }}
          >
            Custom
          </button>
          {preset === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 9px 2px' }}>
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => applyCustom(e.target.value, customTo)}
                style={{ width: '100%' }}
              />
              <span style={{ color: 'var(--text-faint)' }}>–</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                max={todayStr()}
                onChange={(e) => applyCustom(customFrom, e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
