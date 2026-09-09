import { useState } from 'react';
import { Phone, Mail } from 'lucide-react';

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Asks how the follow-up happens before asking when. A prospect who hands over
// the owner's email needs an email, not another dial — and the queue can only
// tell you that later if it's captured here.
export default function FollowupDatePicker({ lead, onPick, onCancel }) {
  const [custom, setCustom] = useState('');
  const [followupType, setFollowupType] = useState('call');
  const [email, setEmail] = useState(lead?.email || '');

  const needsEmail = followupType === 'email';
  const emailMissing = needsEmail && !email.trim();

  function pick(date) {
    if (emailMissing) return;
    onPick(date, {
      followup_type: followupType,
      email: needsEmail ? email.trim() : null,
    });
  }

  return (
    <div className="card" style={{ padding: 14, background: 'var(--bg-elev-2)' }}>
      <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--text-dim)' }}>How do you follow up?</div>
      <div className="role-selector" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`role-btn${followupType === 'call' ? ' active' : ''}`}
          onClick={() => setFollowupType('call')}
        >
          <Phone size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />Call back
        </button>
        <button
          type="button"
          className={`role-btn${followupType === 'email' ? ' active' : ''}`}
          onClick={() => setFollowupType('email')}
        >
          <Mail size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />Send email
        </button>
      </div>

      {needsEmail && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Email address {lead?.email ? '(on file — edit if they gave a new one)' : '(they gave you this on the call)'}
            <input
              type="email"
              autoFocus
              placeholder="owner@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            />
          </label>
        </div>
      )}

      <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--text-dim)' }}>
        {needsEmail ? 'When should this come back up if they don’t reply?' : 'When should this come back up?'}
      </div>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <button className="btn" disabled={emailMissing} onClick={() => pick(addDays(1))}>Tomorrow</button>
        <button className="btn" disabled={emailMissing} onClick={() => pick(addDays(3))}>+3 days</button>
        <button className="btn" disabled={emailMissing} onClick={() => pick(addDays(7))}>+1 week</button>
      </div>
      <div className="toolbar">
        <input type="date" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button className="btn" disabled={!custom || emailMissing} onClick={() => pick(custom)}>Set custom date</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>

      {emailMissing && (
        <div style={{ color: 'var(--orange)', fontSize: 12, marginTop: 8 }}>
          Enter the email address to continue.
        </div>
      )}
    </div>
  );
}
