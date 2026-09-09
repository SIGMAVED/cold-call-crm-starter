// Per-segment funnel (state / niche / city / source). A blended connect rate
// hides the spread once you work several lists at once — this is the view that
// says which one deserves the next 1,000 dials.
//
// Rates are dimmed below MIN_MEANINGFUL_DIALS: 1 meeting off 3 dials is a 33%
// demo rate that means nothing, and reading it as signal is exactly how you
// end up doubling down on noise.
const MIN_MEANINGFUL_DIALS = 25;

export default function SegmentTable({ rows, label }) {
  if (!rows) return <div className="empty-state">Loading…</div>;
  if (rows.length === 0) return <div className="empty-state">No dials in this range yet.</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>{label}</th>
            <th style={{ textAlign: 'right' }}>Dials</th>
            <th style={{ textAlign: 'right' }}>Convos</th>
            <th style={{ textAlign: 'right' }}>Meetings</th>
            <th style={{ textAlign: 'right' }}>Connect</th>
            <th style={{ textAlign: 'right' }}>Demo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const thin = r.dials < MIN_MEANINGFUL_DIALS;
            const rateStyle = thin
              ? { textAlign: 'right', color: 'var(--text-faint)' }
              : { textAlign: 'right' };
            return (
              <tr key={r.label}>
                <td>
                  {r.label}
                  {thin && (
                    <span
                      style={{ color: 'var(--text-faint)', fontSize: 11, marginLeft: 6 }}
                      title={`Under ${MIN_MEANINGFUL_DIALS} dials — rates aren't reliable yet`}
                    >
                      thin
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>{r.dials.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{r.conversations.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{r.meetings.toLocaleString()}</td>
                <td style={rateStyle}>{r.connectRate}%</td>
                <td style={rateStyle}>{r.demoRate}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
