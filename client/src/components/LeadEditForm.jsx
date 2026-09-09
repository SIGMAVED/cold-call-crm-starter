import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import CallRecordings from './CallRecordings.jsx';
import EmailDraftPanel from './EmailDraftPanel.jsx';
import { api } from '../api.js';
import { PRIORITIES, ROLES } from '../constants.js';
import { useSettings } from '../SettingsContext.jsx';

const FIELDS = [
  ['business_name', 'Business Name', 'text'],
  ['contact_name', 'Contact Name', 'text'],
  ['owner_name', 'Owner Name', 'text'],
  ['phone', 'Phone', 'text'],
  ['phone_2', 'Phone 2', 'text'],
  ['email', 'Email', 'text'],
  ['website', 'Website', 'text'],
  ['google_maps_url', 'Google Maps URL', 'text'],
  ['working_hours', 'Working Hours', 'text'],
  ['address', 'Address', 'text'],
  ['city', 'City', 'text'],
  ['state', 'State', 'text'],
  // Free-text, not a strict US/AU dropdown — matches how `state`/`niche` are
  // handled, and leaves room for more markets later without a code change.
  ['country', 'Country', 'text'],
  ['niche', 'Niche / Industry', 'text'],
  ['source', 'Source', 'text'],
  ['review_count', 'Review Count', 'number'],
  ['rating', 'Rating (stars)', 'number'],
  ['lead_score', 'Lead Score', 'number'],
  ['next_followup_date', 'Next Follow-up', 'date'],
];

export default function LeadEditForm({ lead, onSaved, onDeleted }) {
  const { statuses, customFields } = useSettings();
  const [values, setValues] = useState(lead);
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const debounceRef = useRef(null);
  const cfDebounceRef = useRef({});

  useEffect(() => { setValues(lead); }, [lead.id]);
  useEffect(() => { api.getNotes(lead.id).then(setNotes); }, [lead.id]);

  function commit(patch) {
    api.updateLead(lead.id, patch).then((updated) => {
      setValues(updated);
      onSaved?.(updated);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1000);
    });
  }

  function onTextChange(key, value) {
    setValues((v) => ({ ...v, [key]: value }));
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commit({ [key]: value }), 500);
  }

  function onImmediateChange(key, value) {
    setValues((v) => ({ ...v, [key]: value }));
    commit({ [key]: value });
  }

  function onCustomFieldChange(fieldKey, value) {
    setValues((v) => ({ ...v, custom_fields: { ...v.custom_fields, [fieldKey]: value } }));
    clearTimeout(cfDebounceRef.current[fieldKey]);
    cfDebounceRef.current[fieldKey] = setTimeout(() => commit({ custom_fields: { [fieldKey]: value } }), 500);
  }

  // Logging a call/email writes the status server-side, so pull the lead back
  // rather than guessing the new value here — and refresh the activity log,
  // which just gained an entry.
  function refreshAfterLog() {
    api.getLead(lead.id).then((updated) => {
      setValues(updated);
      onSaved?.(updated);
    });
    api.getNotes(lead.id).then(setNotes);
  }

  function addNote() {
    if (!noteText.trim()) return;
    api.addNote(lead.id, noteText.trim()).then((note) => {
      setNotes((n) => [note, ...n]);
      setNoteText('');
    });
  }

  function handleDelete() {
    const name = lead.business_name || lead.contact_name || 'this lead';
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    setDeleting(true);
    api.deleteLead(lead.id).then(() => {
      onDeleted?.(lead.id);
    }).catch(() => setDeleting(false));
  }

  return (
    <div>
      <div className="toolbar" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
        <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
          <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete Lead'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {FIELDS.map(([key, label, type]) => (
          <label key={key} style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {label}
            <input
              type={type}
              value={values[key] || ''}
              onChange={(e) => onTextChange(key, e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            />
          </label>
        ))}
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Status
          <select value={values.status} onChange={(e) => onImmediateChange('status', e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
            {statuses.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Priority
          <select value={values.priority} onChange={(e) => onImmediateChange('priority', e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
            {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Website Quality
          <select value={values.website_quality || ''} onChange={(e) => onImmediateChange('website_quality', e.target.value || null)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
            <option value="">Not evaluated</option>
            <option value="none">None</option>
            <option value="bad">Bad</option>
            <option value="good">Good</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Owner Name Confidence
          <select value={values.owner_name_source || ''} onChange={(e) => onImmediateChange('owner_name_source', e.target.value || null)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
            <option value="">Unknown</option>
            <option value="verified">Verified (confirmed by hand)</option>
            <option value="abn_registry">ABN Registry (AU)</option>
            <option value="website">Website</option>
            <option value="review">Review mention (low)</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Role (who you spoke to)
          <select value={values.role || ''} onChange={(e) => onImmediateChange('role', e.target.value || null)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
            <option value="">—</option>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        {customFields.map((f) => (
          <label key={f.key} style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {f.label}
            <input
              type="text"
              value={values.custom_fields?.[f.key] || ''}
              onChange={(e) => onCustomFieldChange(f.key, e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            />
          </label>
        ))}
      </div>

      {savedFlash && <div style={{ color: 'var(--green)', fontSize: 12, marginTop: 8 }}>Saved</div>}

      <label style={{ fontSize: 12, color: 'var(--text-dim)', display: 'block', marginTop: 12 }}>
        Missed-Call Evidence (review quote)
        <textarea
          value={values.missed_call_evidence || ''}
          onChange={(e) => onTextChange('missed_call_evidence', e.target.value)}
          rows={3}
          placeholder="A customer review showing they miss calls — the opener for this lead."
          style={{ display: 'block', width: '100%', marginTop: 4, fontFamily: 'inherit', resize: 'vertical' }}
        />
      </label>

      <CallRecordings leadId={lead.id} />

      <EmailDraftPanel lead={values} onLogged={refreshAfterLog} />

      <h2 style={{ marginTop: 18 }}>Activity Log</h2>
      <div className="toolbar">
        <input
          placeholder="Add a note…"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addNote()}
          style={{ flex: 1 }}
        />
        <button className="btn" onClick={addNote}>Add Note</button>
      </div>
      <div className="notes-log">
        {notes.length === 0 && <div className="empty-state">No activity yet.</div>}
        {notes.map((n) => (
          <div key={n.id} className="note-entry">
            <div className="ts">{n.created_at}{n.outcome ? ` · ${n.outcome}` : ''}</div>
            {n.body}
          </div>
        ))}
      </div>
    </div>
  );
}
