import { useEffect, useState } from 'react';
import { Trash2, Plus, Repeat } from 'lucide-react';
import { api } from '../api.js';
import { useSettings } from '../SettingsContext.jsx';
import { StatusBadge } from '../components/Badges.jsx';
import { TARGET_METRICS } from '../constants.js';

const COLOR_OPTIONS = [
  ['badge-neutral', 'Neutral'],
  ['badge-info', 'Blue'],
  ['badge-warn', 'Orange'],
  ['badge-success', 'Green'],
  ['badge-danger', 'Red'],
];

function StatusesSection({ statuses, refresh }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('badge-neutral');
  const [error, setError] = useState('');

  function add() {
    if (!name.trim()) return;
    api.createStatus({ name: name.trim(), color }).then(() => {
      setName('');
      setColor('badge-neutral');
      setError('');
      refresh();
    }).catch((e) => setError(e.body?.error || 'Could not add status'));
  }

  function remove(s) {
    if (!window.confirm(`Delete status "${s.name}"? Leads currently on this status will keep it, but it will disappear from filters and the Kanban board.`)) return;
    api.deleteStatus(s.id).then(refresh);
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Pipeline Statuses</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {statuses.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusBadge status={s.name} />
            <button className="btn btn-danger" style={{ marginLeft: 'auto', padding: '4px 10px' }} onClick={() => remove(s)}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="toolbar">
        <input placeholder="New status name…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select value={color} onChange={(e) => setColor(e.target.value)}>
          {COLOR_OPTIONS.map(([cls, label]) => <option key={cls} value={cls}>{label}</option>)}
        </select>
        <button className="btn btn-primary" onClick={add}><Plus size={14} />Add Status</button>
      </div>
      {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function OutcomesSection({ outcomes, statuses, refresh }) {
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState('');
  const [key, setKey] = useState('');
  const [isConnect, setIsConnect] = useState(false);
  const [needsFollowup, setNeedsFollowup] = useState(false);
  const [error, setError] = useState('');

  function add() {
    if (!label.trim() || !status || !key.trim()) { setError('Label, status, and shortcut key are all required.'); return; }
    api.createOutcome({ label: label.trim(), status, key: key.trim(), is_connect: isConnect, needs_followup: needsFollowup }).then(() => {
      setLabel(''); setStatus(''); setKey(''); setIsConnect(false); setNeedsFollowup(false);
      setError('');
      refresh();
    }).catch((e) => setError(e.body?.error || 'Could not add outcome'));
  }

  function remove(o) {
    if (!window.confirm(`Delete the "${o.label}" outcome button?`)) return;
    api.deleteOutcome(o.id).then(refresh);
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Call Outcomes</h2>
      <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 12 }}>
        These are the quick-log buttons shown during a calling session. Each maps to a pipeline status and a single-character keyboard shortcut.
      </div>
      <table>
        <thead><tr><th>Label</th><th>Maps to Status</th><th>Key</th><th>Connect?</th><th>Needs Follow-up?</th><th></th></tr></thead>
        <tbody>
          {outcomes.map((o) => (
            <tr key={o.id}>
              <td>{o.label}</td>
              <td><StatusBadge status={o.status} /></td>
              <td><kbd>{o.key}</kbd></td>
              <td>{o.is_connect ? 'Yes' : '—'}</td>
              <td>{o.needs_followup ? 'Yes' : '—'}</td>
              <td><button className="btn btn-danger" style={{ padding: '4px 10px' }} onClick={() => remove(o)}><Trash2 size={13} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <input placeholder="Outcome label…" value={label} onChange={(e) => setLabel(e.target.value)} style={{ minWidth: 160 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Maps to status…</option>
          {statuses.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <input placeholder="Key (e.g. a)" value={key} onChange={(e) => setKey(e.target.value.slice(0, 1))} style={{ width: 90 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
          <input type="checkbox" checked={isConnect} onChange={(e) => setIsConnect(e.target.checked)} /> Counts as connect
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
          <input type="checkbox" checked={needsFollowup} onChange={(e) => setNeedsFollowup(e.target.checked)} /> Prompts follow-up date
        </label>
        <button className="btn btn-primary" onClick={add}><Plus size={14} />Add Outcome</button>
      </div>
      {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function CustomFieldsSection({ customFields, refresh }) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');

  function add() {
    if (!label.trim()) return;
    api.createCustomField({ label: label.trim() }).then(() => {
      setLabel('');
      setError('');
      refresh();
    }).catch((e) => setError(e.body?.error || 'Could not add field'));
  }

  function remove(f) {
    if (!window.confirm(`Delete the "${f.label}" custom field? Values already saved on leads will no longer be shown.`)) return;
    api.deleteCustomField(f.id).then(refresh);
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Custom Fields</h2>
      <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 12 }}>
        Extra text fields shown on every lead's edit form, in addition to the built-in ones.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {customFields.map((f) => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>{f.label}</span>
            <button className="btn btn-danger" style={{ marginLeft: 'auto', padding: '4px 10px' }} onClick={() => remove(f)}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {customFields.length === 0 && <div className="empty-state">No custom fields yet.</div>}
      </div>
      <div className="toolbar">
        <input placeholder="New field label (e.g. Industry)…" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} style={{ minWidth: 240 }} />
        <button className="btn btn-primary" onClick={add}><Plus size={14} />Add Field</button>
      </div>
      {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function TargetsSection() {
  const [targets, setTargets] = useState(null);
  const [label, setLabel] = useState('');
  const [metric, setMetric] = useState('dials');
  const [targetCount, setTargetCount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [campaign, setCampaign] = useState('');
  const [error, setError] = useState('');
  const [meta, setMeta] = useState(null);

  function refresh() {
    api.listTargets().then(setTargets);
    api.meta().then(setMeta);
  }

  useEffect(refresh, []);

  function add() {
    // End date is optional — leaving it blank makes an open-ended target (a
    // running total with no deadline). A weekly target still needs one to
    // define the span that repeats.
    if (!label.trim() || !targetCount || !startDate) {
      setError('Label, target count and start date are required.');
      return;
    }
    if (recurring && !endDate) {
      setError('A repeating weekly target needs an end date to set its span (e.g. Mon-Fri).');
      return;
    }
    api.createTarget({
      label: label.trim(), metric, target_count: targetCount, start_date: startDate, end_date: endDate,
      recurring: recurring ? 'weekly' : null, campaign,
    }).then(() => {
      setLabel(''); setTargetCount(''); setStartDate(''); setEndDate(''); setRecurring(false); setCampaign('');
      setError('');
      refresh();
    }).catch((e) => setError(e.body?.error || 'Could not add target'));
  }

  function remove(t) {
    if (!window.confirm(`Delete the "${t.label}" target?`)) return;
    api.deleteTarget(t.id).then(refresh);
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Targets</h2>
      <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 12 }}>
        A dials, conversations or owner-conversations goal. Only activity logged inside the range counts toward it, and Analytics shows every target that's still running. A recurring target's Start/End always show the current week — no need to recreate it. <strong>Leave End blank</strong> for an open-ended target (a running total with no deadline). "Owner Conversations" counts distinct leads whose Role is Owner, not individual calls.
      </div>
      <table>
        <thead><tr><th>Label</th><th>Metric</th><th>Target</th><th>Start</th><th>End</th><th>Progress</th><th></th></tr></thead>
        <tbody>
          {targets && targets.length === 0 && <tr><td colSpan={7} className="empty-state">No targets set yet.</td></tr>}
          {targets && targets.map((t) => (
            <tr key={t.id}>
              <td>
                {t.label}
                {t.recurring === 'weekly' && (
                  <span className="badge badge-info" style={{ marginLeft: 6 }} title="Recomputes to the current week automatically">
                    <Repeat size={11} /> Weekly
                  </span>
                )}
                {t.campaign && (
                  <span className="badge badge-neutral" style={{ marginLeft: 6 }}>
                    {t.campaign}
                  </span>
                )}
              </td>
              <td style={{ textTransform: 'capitalize' }}>{t.metric.replace(/_/g, ' ')}</td>
              <td>{t.target_count.toLocaleString()} {t.unit}</td>
              <td>{t.start_date}</td>
              <td>{t.end_date || <span style={{ color: 'var(--text-faint)' }}>open-ended</span>}</td>
              <td>{t.progressCount.toLocaleString()} ({t.percent}%)</td>
              <td><button className="btn btn-danger" style={{ padding: '4px 10px' }} onClick={() => remove(t)}><Trash2 size={13} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <input placeholder="Label (e.g. July 2026)…" value={label} onChange={(e) => setLabel(e.target.value)} style={{ minWidth: 160 }} />
        <select value={metric} onChange={(e) => setMetric(e.target.value)}>
          {TARGET_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <input type="number" placeholder="Target count" value={targetCount} onChange={(e) => setTargetCount(e.target.value)} style={{ width: 130 }} />
        <select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="">Any campaign</option>
          {meta?.campaigns?.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} title="First week's start" />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} title="Leave blank for an open-ended target. For a weekly target this sets the repeating span (e.g. Mon-Fri)." />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-dim)' }}>
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> Repeat weekly
        </label>
        <button className="btn btn-primary" onClick={add}><Plus size={14} />Add Target</button>
      </div>
      {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

export default function Settings() {
  const { statuses, outcomes, customFields, refresh } = useSettings();

  return (
    <div>
      <div className="page-header"><h1>Settings</h1></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <StatusesSection statuses={statuses} refresh={refresh} />
        <OutcomesSection outcomes={outcomes} statuses={statuses} refresh={refresh} />
        <CustomFieldsSection customFields={customFields} refresh={refresh} />
        <TargetsSection />
      </div>
    </div>
  );
}
