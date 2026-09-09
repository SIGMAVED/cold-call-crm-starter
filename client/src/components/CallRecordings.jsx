import { useEffect, useState } from 'react';
import { Mic, Download } from 'lucide-react';
import { api } from '../api.js';

function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Past call recordings for a lead. Audio is streamed through the CRM's own
// /recording proxy, which authenticates to Twilio server-side — the browser
// never touches the Twilio credentials.
export default function CallRecordings({ leadId }) {
  const [calls, setCalls] = useState([]);

  useEffect(() => {
    if (!leadId) { setCalls([]); return; }
    let cancelled = false;
    api.getLeadCalls(leadId)
      .then((rows) => { if (!cancelled) setCalls(rows.filter((c) => c.recording_url)); })
      .catch(() => { if (!cancelled) setCalls([]); });
    return () => { cancelled = true; };
  }, [leadId]);

  if (calls.length === 0) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: 8,
        }}
      >
        <Mic size={13} /> Call recordings ({calls.length})
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {calls.map((c) => (
          <div key={c.id} className="note-entry">
            <div
              className="ts"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
            >
              <span>
                {c.started_at}
                {c.recording_duration_sec != null && ` · ${formatDuration(c.recording_duration_sec)}`}
              </span>
              <a
                href={`/api/calls/${c.id}/recording?download=1`}
                title="Download MP3"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}
              >
                <Download size={12} /> MP3
              </a>
            </div>
            <audio
              controls
              preload="none"
              src={`/api/calls/${c.id}/recording`}
              style={{ width: '100%', marginTop: 6, height: 34 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
