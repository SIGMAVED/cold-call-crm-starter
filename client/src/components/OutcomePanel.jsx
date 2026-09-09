import { useEffect, useState } from 'react';
import {
  Voicemail, PhoneMissed, PhoneOff, Ban, Headset,
  CalendarClock, XCircle, CalendarCheck, PhoneCall, UserX,
} from 'lucide-react';
import { useSettings } from '../SettingsContext.jsx';
import FollowupDatePicker from './FollowupDatePicker.jsx';

const OUTCOME_ICONS = {
  'Ring to Voicemail': PhoneMissed,
  'Direct Voicemail': Voicemail,
  "Couldn't Connect / Busy": PhoneOff,
  'Bad Data / Wrong Number': Ban,
  'Hotline': Headset,
  'Follow up scheduled': CalendarClock,
  'Rejected': XCircle,
  'Meeting Booked': CalendarCheck,
  'NotFit': UserX,
};

// Renders the role selector (who answered — saved on the lead itself),
// the outcome buttons, and, for outcomes flagged needs_followup, the
// inline date picker. When `keyboard` is true, the outcome's shortcut
// key triggers the same button — used in the Active Session view where
// hands stay on the keyboard.
// The funnel roles as stored on the note. `other` exists so "I spoke to a
// human who wasn't the owner or a screener" is recordable — without it those
// calls get left blank and silently look like nobody answered.
const FUNNEL_ROLES = [
  { value: 'owner', label: 'Owner', key: 'o' },
  { value: 'gatekeeper', label: 'Gatekeeper', key: 'g' },
  { value: 'other', label: 'Other', key: 't' },
];

// Email Sent is a real, loggable outcome (EmailDraftPanel's "Mark as Email
// Sent" button on the lead detail page uses it), but it isn't something a
// rep picks mid-call — there's no call to disposition, it's a separate
// email-sending action. Keep it out of this quick-pick grid specifically;
// it still exists everywhere else (Settings, the lead's activity log).
const SESSION_HIDDEN_OUTCOMES = new Set(['Email Sent']);

export default function OutcomePanel({ lead, onSubmit, onRoleChange, keyboard = false, big = false }) {
  const { outcomes: allOutcomes } = useSettings();
  const outcomes = allOutcomes.filter((o) => !SESSION_HIDDEN_OUTCOMES.has(o.label));
  const [pendingOutcome, setPendingOutcome] = useState(null);
  const [note, setNote] = useState('');
  // Seed from the lead's stored role so a known contact isn't re-tagged from
  // scratch, but everything here is per-call and resets on lead change.
  const [role, setRole] = useState(lead?.role ? lead.role.toLowerCase() : null);
  const [presented, setPresented] = useState(null);
  const [appointment, setAppointment] = useState(null);
  const [nudge, setNudge] = useState('');

  useEffect(() => {
    setRole(lead?.role ? lead.role.toLowerCase() : null);
    setPresented(null);
    setAppointment(null);
    setNudge('');
  }, [lead?.id]);

  // Tri-state: unset -> yes -> no -> unset. NULL must stay reachable so
  // "didn't record" never collapses into "no".
  const cycle = (v) => (v === null ? 1 : v === 1 ? 0 : null);

  function selectRole(r) {
    setRole((prev) => (prev === r ? null : r));
  }

  function choose(outcome) {
    // Quiet, non-blocking: a connect logged with nobody recorded is the gap
    // that makes the funnel unmeasurable, but blocking the save would cost
    // more than the missing datapoint.
    if (outcome.is_connect && !role) setNudge('Saved — but no one was tagged (O / G / T)');
    else setNudge('');

    const metrics = { contact_role: role, presented, appointment_set: appointment };
    if (outcome.needs_followup) {
      setPendingOutcome({ outcome, metrics });
    } else {
      onSubmit(outcome, null, note, metrics);
      setNote('');
      setPresented(null);
      setAppointment(null);
    }
  }

  // `extra` carries the follow-up channel (call vs email) and, for an email
  // follow-up, the address captured on the call.
  function pickFollowupDate(date, extra) {
    onSubmit(pendingOutcome.outcome, date, note, { ...extra, ...pendingOutcome.metrics });
    setPendingOutcome(null);
    setNote('');
    setPresented(null);
    setAppointment(null);
  }

  useEffect(() => {
    if (!keyboard) return;
    function handler(e) {
      if (pendingOutcome) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();

      // Funnel keys are checked before dispositions so a single keystroke sets
      // who/what without leaving the disposition screen.
      const roleHit = FUNNEL_ROLES.find((r) => r.key === k);
      if (roleHit) { e.preventDefault(); selectRole(roleHit.value); return; }
      if (k === 'p') { e.preventDefault(); setPresented(cycle); return; }
      if (k === 'a') { e.preventDefault(); setAppointment(cycle); return; }

      const match = outcomes.find((o) => o.key === e.key);
      if (match) {
        e.preventDefault();
        choose(match);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboard, pendingOutcome, note, outcomes, role, presented, appointment]);

  if (pendingOutcome) {
    return (
      <FollowupDatePicker
        lead={lead}
        onPick={pickFollowupDate}
        onCancel={() => setPendingOutcome(null)}
      />
    );
  }

  return (
    <div>
      {lead && (
        <>
          <div className="role-selector">
            <span className="role-selector-label">Spoke to:</span>
            {FUNNEL_ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`role-btn${role === r.value ? ' active' : ''}`}
                onClick={() => selectRole(r.value)}
              >
                {r.label}{keyboard && <kbd style={{ marginLeft: 6 }}>{r.key.toUpperCase()}</kbd>}
              </button>
            ))}
          </div>
          <div className="role-selector">
            <span className="role-selector-label">Pitch:</span>
            <button
              type="button"
              className={`role-btn${presented === 1 ? ' active' : ''}${presented === 0 ? ' role-btn-no' : ''}`}
              onClick={() => setPresented(cycle)}
              title="Only if you delivered the full pitch AND asked for something specific — a demo, a callback time, permission to text the number. A friendly chat with no ask is NOT a presentation."
            >
              {presented === 1 ? 'Presented ✓' : presented === 0 ? 'No pitch' : 'Presented?'}
              {keyboard && <kbd style={{ marginLeft: 6 }}>P</kbd>}
            </button>
            <button
              type="button"
              className={`role-btn${appointment === 1 ? ' active' : ''}${appointment === 0 ? ' role-btn-no' : ''}`}
              onClick={() => setAppointment(cycle)}
              title="A specific date/time was agreed."
            >
              {appointment === 1 ? 'Appt set ✓' : appointment === 0 ? 'No appt' : 'Appt?'}
              {keyboard && <kbd style={{ marginLeft: 6 }}>A</kbd>}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              full pitch + explicit ask
            </span>
          </div>
          {nudge && (
            <div style={{ fontSize: 11.5, color: 'var(--orange)', marginBottom: 8 }}>{nudge}</div>
          )}
        </>
      )}
      <textarea
        className="outcome-note"
        placeholder="Note for this call (optional)…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
      />
      <div className={`outcome-grid${big ? ' outcome-grid-big' : ''}`}>
        {outcomes.map((o) => {
          const Icon = OUTCOME_ICONS[o.label] || PhoneCall;
          return (
            <button key={o.label} className="outcome-btn" onClick={() => choose(o)}>
              {Icon && <Icon size={18} />}
              <span>{o.label}</span>
              {keyboard && <kbd>{o.key}</kbd>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
