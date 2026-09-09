import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Clock, CheckCircle2, Inbox, Target, StickyNote, Mail, Star, Globe, MapPin, Clock3, AlertTriangle } from 'lucide-react';
import { api } from '../api.js';
import { PriorityBadge, StatusBadge } from '../components/Badges.jsx';
import OutcomePanel from '../components/OutcomePanel.jsx';
import CallRecordings from '../components/CallRecordings.jsx';
import LocalTime from '../components/LocalTime.jsx';
import { maybeCelebrateDailyGoal } from '../confetti.js';
import { DAILY_DIAL_GOAL } from '../constants.js';
import { telHref, withHttp, prettyUrl } from '../phone.js';

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function Session() {
  const [leads, setLeads] = useState(null);
  const [index, setIndex] = useState(0);
  const [startedAt] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [flash, setFlash] = useState('');
  const [dialsToday, setDialsToday] = useState(null);
  const [notes, setNotes] = useState([]);
  const advancingRef = useRef(false);
  const sessionIdRef = useRef(null);
  const dialCountRef = useRef(0);

  useEffect(() => {
    const raw = localStorage.getItem('ccrm_session_ids');
    const ids = raw ? JSON.parse(raw) : [];
    if (ids.length === 0) { setLeads([]); return; }
    api.leadsByIds(ids).then(setLeads);
  }, []);

  // Seed today's running dial total so the daily-goal progress is accurate
  // from the first render (in case dials were already logged earlier today).
  useEffect(() => {
    api.analytics().then((d) => setDialsToday(d.todayDials)).catch(() => {});
  }, []);

  // Create a session record the moment a queued list of leads is loaded —
  // this tracks wall-clock duration and dial count so we can report a
  // dials-per-hour rate, independent of how the call-logging state changes.
  useEffect(() => {
    if (leads && leads.length > 0 && sessionIdRef.current === null) {
      api.startSession(leads.length).then((s) => { sessionIdRef.current = s.id; });
    }
  }, [leads]);

  // Leaving this page ends the session: clear the queued list so a later
  // visit to /session (via the nav link, not a same-tab refresh) shows the
  // empty state instead of silently resuming a stale, already-abandoned
  // batch of leads.
  useEffect(() => {
    return () => {
      localStorage.removeItem('ccrm_session_ids');
      if (sessionIdRef.current) {
        api.updateSession(sessionIdRef.current, dialCountRef.current).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const advance = useCallback(() => {
    setIndex((i) => Math.min(i + 1, (leads?.length || 1) - 1));
  }, [leads]);

  const goPrev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  async function handleLogged(outcome, date, note, extra) {
    const lead = leads[index];
    if (!lead || advancingRef.current) return;
    advancingRef.current = true;
    try {
      const updated = await api.logCall(lead.id, {
        outcome: outcome.label,
        next_followup_date: date,
        note_text: note,
        followup_type: extra?.followup_type ?? null,
        email: extra?.email ?? null,
      contact_role: extra?.contact_role ?? null,
      presented: extra?.presented ?? null,
      appointment_set: extra?.appointment_set ?? null,
      });
      setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      setFlash(outcome.label);
      setTimeout(() => setFlash(''), 900);
      dialCountRef.current += 1;
      if (typeof updated.todayDials === 'number') {
        setDialsToday(updated.todayDials);
        maybeCelebrateDailyGoal(updated.todayDials);
      }
      if (sessionIdRef.current) api.updateSession(sessionIdRef.current, dialCountRef.current).catch(() => {});
      advance();
    } finally {
      advancingRef.current = false;
    }
  }

  useEffect(() => {
    function onKey(e) {
      if (['Enter', ' '].includes(e.key)) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        advance();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance]);

  // Prior call history for the lead on screen — the whole point of a
  // follow-up is remembering what was said last time, so pull the notes in
  // rather than making the rep leave the session to look them up.
  // Derived (not read off `lead`) so this hook stays above the early
  // returns below and hook order never changes between renders.
  const currentLeadId = leads && leads.length > 0 ? leads[index]?.id ?? null : null;

  useEffect(() => {
    if (!currentLeadId) { setNotes([]); return; }
    let cancelled = false;
    api.getNotes(currentLeadId)
      .then((n) => { if (!cancelled) setNotes(n); })
      .catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, [currentLeadId]);

  if (leads === null) return <div className="empty-state">Loading session…</div>;

  if (leads.length === 0) {
    return (
      <div>
        <div className="page-header"><h1>Active Session</h1></div>
        <div className="empty-state card">
          <Inbox size={22} style={{ marginBottom: 8, opacity: 0.6 }} />
          <div>No session queued yet. Go to <Link to="/queue">Today's Queue</Link>, select leads, and click "Copy Autodial List" to start a session.</div>
        </div>
      </div>
    );
  }

  const lead = leads[index];
  const progressPct = ((index + 1) / leads.length) * 100;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1>Active Session</h1>
          <div className="page-header-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={13} /> Session time {formatElapsed(elapsed)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {dialsToday !== null && (
            <div
              className="page-header-sub"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end',
                fontWeight: 600,
                color: dialsToday >= DAILY_DIAL_GOAL ? 'var(--green)' : 'var(--text-dim)',
              }}
            >
              <Target size={13} /> {dialsToday} / {DAILY_DIAL_GOAL} dials today
              {dialsToday >= DAILY_DIAL_GOAL && ' 🎉'}
            </div>
          )}
          <div className="page-header-sub">Lead {index + 1} of {leads.length}</div>
        </div>
      </div>

      <div className="session-progress-track">
        <div className="session-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{lead.business_name || 'Unnamed business'}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={lead.priority}
              onChange={(e) => {
                const p = e.target.value;
                api.updateLead(lead.id, { priority: p }).then(updated => {
                  setLeads(prev => {
                    const c = [...prev];
                    c[index] = updated;
                    return c;
                  });
                  setFlash(`Priority changed to ${p}`);
                  setTimeout(() => setFlash(''), 2000);
                }).catch(() => alert('Failed to update priority'));
              }}
              className={`badge badge-${(lead.priority || 'warm').toLowerCase()}`}
              style={{ border: 'none', cursor: 'pointer', outline: 'none', padding: '4px 8px' }}
              title="Click to change priority"
            >
              <option value="Cold">Cold</option>
              <option value="Warm">Warm</option>
              <option value="Hot">Hot</option>
            </select>
            <StatusBadge status={lead.status} />
          </div>
        </div>
        {lead.local && (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}>
            <LocalTime local={lead.local} size={14} />
            <span style={{ color: 'var(--text-faint)' }}>their local time</span>
          </div>
        )}

        <div style={{ color: 'var(--text-dim)', marginTop: 6, fontSize: 13.5 }}>
          {lead.owner_name && <>Owner: <strong style={{ color: 'var(--text)' }}>{lead.owner_name}</strong> · </>}
          {lead.contact_name && `${lead.contact_name} · `}
          {lead.city && `${lead.city}, ${lead.state} · `}
          Calls so far: {lead.call_count}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13.5 }}>
          {lead.review_count != null && (
            <span className="badge badge-neutral" title="Google reviews">
              <Star size={12} /> {lead.review_count.toLocaleString()} reviews
            </span>
          )}
          {lead.website && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Globe size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              <a href={withHttp(lead.website)} target="_blank" rel="noreferrer">{prettyUrl(lead.website)}</a>
            </span>
          )}
          {lead.google_maps_url && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <MapPin size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              <a href={lead.google_maps_url} target="_blank" rel="noreferrer">Google Maps</a>
            </span>
          )}
        </div>

        {lead.working_hours && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 8, fontSize: 13.5 }}>
            <Clock3 size={14} style={{ color: 'var(--text-dim)', flexShrink: 0, marginTop: 2 }} />
            <span style={{ color: 'var(--text-dim)' }}>{lead.working_hours}</span>
          </div>
        )}

        {/* The prospect's own customer saying they miss calls — the strongest
            opener available, so it sits above the fold, not in the notes. */}
        {lead.missed_call_evidence && (
          <div
            style={{
              marginTop: 12, padding: '10px 12px', borderRadius: 8,
              background: 'var(--orange-soft)', borderLeft: '3px solid var(--orange)',
            }}
          >
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.05em', color: 'var(--orange)', marginBottom: 4,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <AlertTriangle size={12} /> Their review says they miss calls
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5, fontStyle: 'italic' }}>
              “{lead.missed_call_evidence}”
            </div>
          </div>
        )}

        {lead.email && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 13.5 }}>
            <Mail size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            <a href={`mailto:${lead.email}`}>{lead.email}</a>
            {lead.followup_type === 'email' && (
              <span className="badge badge-warn" style={{ marginLeft: 4 }}>Email follow-up due</span>
            )}
          </div>
        )}

        {notes.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--text-dim)',
              }}
            >
              <StickyNote size={13} /> Previous notes ({notes.length})
            </div>
            <div className="notes-log">
              {notes.map((n) => (
                <div key={n.id} className="note-entry">
                  <div className="ts">{n.created_at}{n.outcome ? ` · ${n.outcome}` : ''}</div>
                  {n.body}
                </div>
              ))}
            </div>
          </div>
        )}

        <CallRecordings leadId={lead.id} />

        <a href={telHref(lead.phone, lead.country)} className="session-phone">{lead.phone}</a>

        {flash && (
          <div style={{ textAlign: 'center', color: 'var(--green)', fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <CheckCircle2 size={16} /> Logged: {flash}
          </div>
        )}

        <OutcomePanel
          lead={lead}
          onSubmit={handleLogged}
          onRoleChange={(updated) => setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))}
          keyboard
          big
        />

        <div className="toolbar" style={{ marginTop: 18, justifyContent: 'center' }}>
          <button className="btn" onClick={goPrev} disabled={index === 0}><ArrowLeft size={15} />Prev</button>
          <span style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>Enter / Space = Next (no log)</span>
          <button className="btn" onClick={advance} disabled={index === leads.length - 1}>Next<ArrowRight size={15} /></button>
        </div>
      </div>
    </div>
  );
}
