import { useEffect, useState } from 'react';
import { Mail, Copy, ExternalLink, Check, Sparkles } from 'lucide-react';
import { api } from '../api.js';

// Gmail compose has no "from" param — the send-as identity is whichever
// Google account is active. authuser picks which signed-in account Gmail
// opens as, so this always composes from the business inbox, not whichever
// browser profile happens to be default.
// Set this to your own business inbox before going live.
const SEND_FROM = 'you@yourbusiness.com';

// Drafts a follow-up email from the lead's call history via Gemini. Never
// sends anything itself — the rep reviews/edits the draft, then either
// copies it or opens it pre-filled in Gmail compose to send by hand.
export default function EmailDraftPanel({ lead, onLogged }) {
  const [draft, setDraft] = useState(null); // { to, subject, body }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  function generate() {
    setLoading(true);
    setError('');
    api.draftEmail(lead.id, lead.email)
      .then((d) => { setDraft(d); setCopied(false); })
      .catch((err) => setError(err.body?.error || err.message || 'Could not draft an email'))
      .finally(() => setLoading(false));
  }

  function copyDraft() {
    navigator.clipboard.writeText(draft.body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function gmailComposeUrl() {
    const params = new URLSearchParams({
      view: 'cm', fs: '1',
      to: draft.to || '',
      su: draft.subject || '',
      body: draft.body || '',
      authuser: SEND_FROM,
    });
    return `https://mail.google.com/mail/?${params.toString()}`;
  }

  const [sentMarked, setSentMarked] = useState(false);

  function markAsSent() {
    // Both buttons route here, and the Gmail link fires on every click — so
    // without this guard one email logs two or three dispositions, inflating
    // call_count and the Email Sent counts.
    if (sentMarked) return;
    setSentMarked(true);
    // The actual subject/body has to be saved here, not just the recipient —
    // otherwise a redraft or a page refresh loses the only record of what
    // was actually sent, and a later follow-up has no idea what was already
    // said.
    api.logCall(lead.id, {
      outcome: 'Email Sent',
      note_text: `Sent follow-up email to: ${draft?.to || lead.email || 'prospect'}\n\nSubject: ${draft?.subject || ''}\n\n${draft?.body || ''}`,
      email: draft?.to || lead.email,
    })
      // The status lives on the lead, so the form above has to be told to
      // re-read it — otherwise the DB says "Email Sent" while the Status
      // dropdown on screen still shows the old value and it looks broken.
      .then(() => onLogged?.())
      .catch(() => setSentMarked(false));
  }

  function handleOpenGmail() {
    markAsSent();
  }

  // A fresh draft is a new send, so the button arms again.
  useEffect(() => { setSentMarked(false); }, [draft]);

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Follow-up Email</h2>
        <button className="btn" onClick={generate} disabled={loading}>
          <Sparkles size={14} /> {loading ? 'Drafting…' : draft ? 'Redraft' : 'Draft Follow-up Email'}
        </button>
      </div>

      {error && <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 8 }}>{error}</div>}

      {draft && (
        <div className="card" style={{ marginTop: 10 }}>
          <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            To
            <input
              value={draft.to || ''}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              placeholder="prospect@example.com"
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 12, color: 'var(--text-dim)', display: 'block', marginTop: 10 }}>
            Subject
            <input
              value={draft.subject || ''}
              onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 12, color: 'var(--text-dim)', display: 'block', marginTop: 10 }}>
            Body — review before sending, this is AI-drafted
            <textarea
              value={draft.body || ''}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              rows={8}
              style={{ display: 'block', width: '100%', marginTop: 4, fontFamily: 'inherit', resize: 'vertical' }}
            />
          </label>

          <div className="toolbar" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
            <button className="btn" onClick={copyDraft}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy Body'}
            </button>
            <a
              className="btn btn-primary"
              href={gmailComposeUrl()}
              onClick={handleOpenGmail}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <ExternalLink size={14} /> Open in Gmail & Mark Sent
            </a>
            <button className="btn btn-info" onClick={markAsSent} disabled={sentMarked}>
              {sentMarked ? <Check size={14} /> : <Mail size={14} />} {sentMarked ? 'Status: Email Sent ✓' : 'Mark as Email Sent'}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 6 }}>
            Opens Gmail as <strong>{SEND_FROM}</strong> — make sure you're signed into that account in this browser.
          </div>
        </div>
      )}

      {!draft && !error && !loading && (
        <div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Mail size={12} /> Drafts from this lead's call notes and transcripts — you always review before sending.
        </div>
      )}
    </div>
  );
}
