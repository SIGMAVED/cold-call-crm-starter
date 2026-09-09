import { useEffect, useState } from 'react';
import { PhoneCall, UserCheck, Presentation, CalendarCheck, AlertTriangle, Info } from 'lucide-react';
import { api } from '../api.js';
import BarChart from '../components/BarChart.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';

const REFRESH_MS = 30000;

const STAGE_META = [
  { key: 'dials', label: 'Dials', icon: PhoneCall, rateKey: null },
  { key: 'owners', label: 'Owners reached', icon: UserCheck, rateKey: 'ownerRate' },
  { key: 'presentations', label: 'Presentations', icon: Presentation, rateKey: 'presentationRate' },
  { key: 'appointments', label: 'Appointments', icon: CalendarCheck, rateKey: 'appointmentRate' },
];

const STATUS_COLOR = {
  good: 'var(--green)',
  below: 'var(--red)',
  uncertain: 'var(--orange)',
  unknown: 'var(--text-faint)',
};

// A rate plus its confidence interval. The interval is the point — a 75%
// appointment rate off 4 presentations is not a 75% appointment rate.
function Rate({ rate }) {
  if (!rate || !rate.total) return <span style={{ color: 'var(--text-faint)' }}>—</span>;
  const color = STATUS_COLOR[rate.status];
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ color, fontWeight: 700 }}>
        {rate.value}%
        {rate.thin && (
          <span style={{ color: 'var(--text-faint)', fontWeight: 400, fontSize: 11, marginLeft: 5 }}>
            n={rate.total}
          </span>
        )}
      </span>
      <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>
        95% CI {rate.ci.low}–{rate.ci.high} · target {rate.targetLabel}
      </span>
    </span>
  );
}

function SegmentTable({ rows, label, minN }) {
  if (!rows) return <div className="empty-state">Loading…</div>;
  if (!rows.length) return <div className="empty-state">No dials in this range.</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>{label}</th>
            <th style={{ textAlign: 'right' }}>Dials</th>
            <th style={{ textAlign: 'right' }}>Own</th>
            <th style={{ textAlign: 'right' }}>Pres</th>
            <th style={{ textAlign: 'right' }}>Appt</th>
            <th style={{ textAlign: 'right' }}>Owner rate</th>
            <th style={{ textAlign: 'right' }}>Pres rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // Under the threshold the whole row is greyed: these numbers move
            // wildly on one extra call and shouldn't drive a decision.
            const thin = r.dials < minN;
            return (
              <tr key={r.label} style={thin ? { opacity: 0.4 } : undefined}>
                <td>
                  {r.label}
                  {r.istLabel && <span style={{ color: 'var(--text-faint)', fontSize: 11 }}> · {r.istLabel} IST</span>}
                  {thin && <span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}> (n&lt;{minN})</span>}
                </td>
                <td style={{ textAlign: 'right' }}>{r.dials}</td>
                <td style={{ textAlign: 'right' }}>{r.owners}</td>
                <td style={{ textAlign: 'right' }}>{r.presentations}</td>
                <td style={{ textAlign: 'right' }}>{r.appointments}</td>
                <td style={{ textAlign: 'right' }}><Rate rate={r.ownerRate} /></td>
                <td style={{ textAlign: 'right' }}><Rate rate={r.presentationRate} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Funnel() {
  const [data, setData] = useState(null);
  const [range, setRange] = useState({ from: '2026-07-08', to: '2026-08-15' });

  useEffect(() => {
    let cancelled = false;
    setData(null);
    const load = () => api.funnel(range).then((d) => { if (!cancelled) setData(d); }).catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [range.from, range.to]);

  const o = data?.overall;

  const trend = (key) => (data?.daily || []).map((d) => ({
    label: String(new Date(`${d.day}T00:00:00Z`).getUTCDate()),
    fullLabel: new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    value: d[key],
  }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Funnel</h1>
          <div className="page-header-sub">Where the calling actually breaks — dials → owners → presentations → appointments.</div>
        </div>
      </div>

      <DateRangePicker value={range} onChange={setRange} />

      {data && data.coverage.pct < 60 && (
        <div className="card" style={{ marginBottom: 18, borderLeft: '3px solid var(--orange)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Info size={15} style={{ color: 'var(--orange)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
              <strong style={{ color: 'var(--text)' }}>Only {data.coverage.pct}% of dials have a contact tagged</strong>{' '}
              ({data.coverage.roleTagged} of {data.coverage.dials}). Rates below are computed on what was
              tagged, so the owner rate is a floor, not the truth. Tag with <kbd>O</kbd>/<kbd>G</kbd>/<kbd>T</kbd> during
              the call and this becomes real within a session.
            </div>
          </div>
        </div>
      )}

      {data?.weakest && (
        <div className="card" style={{ marginBottom: 18, borderLeft: `3px solid ${data.weakest.certain ? 'var(--red)' : 'var(--orange)'}` }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle size={17} style={{ color: data.weakest.certain ? 'var(--red)' : 'var(--orange)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)' }}>
                Weakest link{!data.weakest.certain && ' (not yet certain)'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>
                {data.weakest.label} — {data.weakest.value}% vs {data.weakest.target}% target
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>{data.weakest.diagnosis}</div>
            </div>
          </div>
        </div>
      )}

      <div className="stats-bar">
        {STAGE_META.map(({ key, label, icon: Icon, rateKey }) => (
          <div key={key} className="stat-box">
            <div className="stat-icon"><Icon size={17} /></div>
            <div>
              <div className="value">{o ? o[key].toLocaleString() : '—'}</div>
              <div className="label">{label}</div>
              {rateKey && o && (
                <div style={{ marginTop: 4 }}><Rate rate={o[rateKey]} /></div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 20, margin: '24px 0' }}>
        {STAGE_META.map(({ key, label }) => (
          <div className="card" key={key}>
            <h2>{label} per day</h2>
            {data ? <BarChart data={trend(key)} unitLabel={label.toLowerCase()} /> : <div className="empty-state">Loading…</div>}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
        <div className="card">
          <h2>By state</h2>
          <SegmentTable rows={data?.byState} label="State" minN={data?.minN ?? 30} />
        </div>
        <div className="card">
          <h2>By hour <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)' }}>(US Eastern · IST shown too)</span></h2>
          <SegmentTable rows={data?.byHour} label="Hour (ET)" minN={data?.minN ?? 30} />
        </div>
      </div>
    </div>
  );
}
