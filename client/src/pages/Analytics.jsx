import { useEffect, useState } from 'react';
import {
  PhoneCall, CalendarClock, TrendingUp, TrendingDown, Ban, CalendarCheck, Voicemail, Download,
} from 'lucide-react';
import { api } from '../api.js';
import BarChart from '../components/BarChart.jsx';
import HBarChart from '../components/HBarChart.jsx';
import TargetMeter from '../components/TargetMeter.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import SegmentTable from '../components/SegmentTable.jsx';

const REFRESH_MS = 15000;

function toLocalMs(sqliteTimestamp) {
  return new Date(`${sqliteTimestamp.replace(' ', 'T')}Z`).getTime();
}

function formatStarted(sqliteTimestamp) {
  return new Date(toLocalMs(sqliteTimestamp)).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatDuration(minutes) {
  if (minutes < 1) return '<1m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const METRIC_DEFS = [
  { key: 'totalDials', label: 'Total Dials', icon: PhoneCall, format: (v) => v },
  { key: 'todayDials', label: "Today's Dials", icon: CalendarClock, format: (v) => v },
  { key: 'connectRate', label: 'Connect Rate', icon: TrendingUp, format: (v) => `${v}%`,
    title: 'Human Interactions ÷ Total Dials. Human Interactions = Gatekeeper - Blocked, Immediate Hangup, Connected - Pitched (No), Connected - Follow Up.' },
  { key: 'rejectionRate', label: 'Rejection Rate', icon: TrendingDown, format: (v) => `${v}%`,
    title: "Leads with status 'Rejected (Dead)' ÷ distinct leads dialed at least once." },
  { key: 'junkDataCount', label: 'Junk Data', icon: Ban, format: (v) => v,
    title: "Leads with status 'Bad Data' (from a 'Junk Data' disposition)." },
  { key: 'demoRate', label: 'Demo Rate', icon: CalendarCheck, format: (v) => `${v}%`,
    title: "Leads with status 'Qualified / Hot Lead' ÷ Human Interactions." },
  { key: 'voicemailRate', label: 'Voicemail Rate', icon: Voicemail, format: (v) => `${v}%`,
    title: "Dials with disposition 'Direct to Voicemail' or 'Ring to Voicemail' ÷ Total Dials." },
];

export default function Analytics() {
  const [stats, setStats] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [dailyDials, setDailyDials] = useState(null);
  const [dispositions, setDispositions] = useState(null);
  const [roles, setRoles] = useState(null);
  const [targets, setTargets] = useState([]);
  const [spendDaily, setSpendDaily] = useState(null);
  const [byState, setByState] = useState(null);
  const [byNiche, setByNiche] = useState(null);
  const [byReviews, setByReviews] = useState(null);
  // Defaults to the current active goal window.
  const [range, setRange] = useState({ from: '2026-08-13', to: new Date().toISOString().slice(0, 10) });

  useEffect(() => {
    let cancelled = false;
    setStats(null); setSessions(null); setDailyDials(null); setDispositions(null); setRoles(null); setSpendDaily(null);
    setByState(null); setByNiche(null); setByReviews(null);
    function load() {
      api.segments('state', range).then((d) => { if (!cancelled) setByState(d); }).catch(() => {});
      api.segments('niche', range).then((d) => { if (!cancelled) setByNiche(d); }).catch(() => {});
      api.segments('reviews', range).then((d) => { if (!cancelled) setByReviews(d); }).catch(() => {});
      api.analytics(range).then((data) => { if (!cancelled) setStats(data); });
      api.listSessions(range).then((data) => { if (!cancelled) setSessions(data); });
      api.dailyDials(range).then((data) => { if (!cancelled) setDailyDials(data); });
      api.dispositionBreakdown(range).then((data) => { if (!cancelled) setDispositions(data); });
      api.roleBreakdown(range).then((data) => { if (!cancelled) setRoles(data); });
      api.twilioDailyUsage(range).then((data) => { if (!cancelled) setSpendDaily(data.series); }).catch(() => {});
      api.activeTargets().then((data) => { if (!cancelled) setTargets(data || []); }).catch(() => {});
    }
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [range.from, range.to]);

  const dailyDialsChart = dailyDials?.map((d) => ({
    label: String(new Date(`${d.date}T00:00:00Z`).getUTCDate()),
    fullLabel: new Date(`${d.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    value: d.count,
  })) || [];

  const dispositionChart = dispositions?.map((d) => ({ label: d.label, value: d.count })) || [];
  const roleChart = roles?.map((r) => ({ label: r.label, value: r.count })) || [];
  const spendChart = spendDaily?.map((d) => ({
    label: String(new Date(`${d.date}T00:00:00Z`).getUTCDate()),
    fullLabel: new Date(`${d.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    value: d.inr,
  })) || [];
  const spendTotal = spendDaily?.reduce((sum, d) => sum + d.inr, 0) ?? null;

  const sessionsChart = sessions
    ? [...sessions].reverse().filter((s) => s.dialsPerHour !== null).map((s) => ({
        label: new Date(toLocalMs(s.started_at)).toLocaleDateString(undefined, { day: 'numeric' }),
        fullLabel: formatStarted(s.started_at),
        value: s.dialsPerHour,
      }))
    : [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <div className="page-header-sub">Cold-calling performance, refreshed every 15 seconds.</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <DateRangePicker value={range} onChange={setRange} noMargin />
        <a
          className="btn"
          href={`/api/export?from=${range.from}&to=${range.to}`}
          title="Download leads + this date range's analytics as one Excel file"
        >
          <Download size={14} /> Export
        </a>
      </div>

      {targets.map((t) => <TargetMeter key={t.id} target={t} />)}

      <div className="stats-bar">
        {METRIC_DEFS.map(({ key, label, icon: Icon, format, title }) => (
          <div key={key} className="stat-box" title={title}>
            <div className="stat-icon"><Icon size={17} /></div>
            <div>
              <div className="value">{stats ? format(stats[key]) : '—'}</div>
              <div className="label">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {stats && (
        <div className="card" style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 24 }}>
          {stats.humanInteractions} human interactions across {stats.totalDials} total dials · {stats.leadsDialed} distinct leads dialed.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 20, marginBottom: 24 }}>
        <div className="card">
          <h2>Dials Per Day</h2>
          {dailyDials ? <BarChart data={dailyDialsChart} unitLabel="dials" /> : <div className="empty-state">Loading…</div>}
        </div>
        <div className="card">
          <h2>Twilio Spend Per Day{spendTotal !== null && ` · ₹${spendTotal.toFixed(2)} total`}</h2>
          {spendDaily ? <BarChart data={spendChart} unitLabel="₹" /> : <div className="empty-state">Loading…</div>}
        </div>
        <div className="card">
          <h2>Disposition Breakdown</h2>
          {dispositions ? <HBarChart data={dispositionChart} /> : <div className="empty-state">Loading…</div>}
        </div>
        <div className="card">
          <h2>Role Reached</h2>
          {roles ? <HBarChart data={roleChart} /> : <div className="empty-state">Loading…</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 20, marginBottom: 24 }}>
        <div className="card">
          <h2>Performance by State</h2>
          <SegmentTable rows={byState} label="State" />
        </div>
        <div className="card">
          <h2>Performance by Niche</h2>
          <SegmentTable rows={byNiche} label="Niche" />
        </div>
        <div className="card">
          <h2>Performance by Review Count</h2>
          <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: -6, marginBottom: 10 }}>
            Business size, roughly — fewer reviews usually means the owner picks up.
          </div>
          <SegmentTable rows={byReviews} label="Reviews" />
        </div>
      </div>

      <h2>Session History</h2>
      {sessionsChart.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="progress-label" style={{ marginBottom: 14 }}>Dials / hour, by session (most recent {sessionsChart.length})</div>
          <BarChart data={sessionsChart} unitLabel="dials/hr" />
        </div>
      )}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>Started</th><th>Duration</th><th>Leads Queued</th><th>Dials Logged</th><th>Dials / Hour</th></tr>
          </thead>
          <tbody>
            {sessions && sessions.length === 0 && (
              <tr><td colSpan={5} className="empty-state">No Active Session runs yet — start one from Today's Queue.</td></tr>
            )}
            {sessions && sessions.map((s) => (
              <tr key={s.id}>
                <td>{formatStarted(s.started_at)}</td>
                <td>{formatDuration(s.durationMinutes)}</td>
                <td>{s.lead_count}</td>
                <td>{s.dial_count}</td>
                <td>{s.dialsPerHour !== null ? s.dialsPerHour : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
