import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Mail, Phone } from 'lucide-react';
import { api } from '../api.js';
import { PriorityBadge, StatusBadge } from '../components/Badges.jsx';
import OutcomePanel from '../components/OutcomePanel.jsx';
import LocalTime from '../components/LocalTime.jsx';
import { formatPhone, telHref } from '../phone.js';
import { maybeCelebrateDailyGoal } from '../confetti.js';

const PHONE_FORMAT_KEY = 'ccrm_phone_format';
const SELECT_PRESETS = [10, 20, 30, 40, 50];

function LeadRow({ lead, checked, onToggle, onLogged, onRoleChange, expanded, onExpand }) {
  return (
    <>
      <tr onClick={() => onExpand(expanded ? null : lead.id)} style={{ cursor: 'pointer' }}>
        <td className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={() => onToggle(lead.id)} />
        </td>
        <td>{lead.business_name || <em style={{ color: 'var(--text-dim)' }}>Unnamed</em>}</td>
        {/* owner_name is the field actually populated by research/scraping —
            contact_name is mostly empty, so showing it alone made "Has owner
            name" leads look ownerless in this column even though the filter
            (which checks owner_name) was working correctly. */}
        <td>{lead.contact_name || lead.owner_name}</td>
        <td onClick={(e) => e.stopPropagation()}>
          <a href={telHref(lead.phone, lead.country)} className="btn" style={{ padding: '4px 10px' }}>{lead.phone}</a>
        </td>
        <td>{lead.city}</td>
        <td><LocalTime local={lead.local} /></td>
        <td><PriorityBadge priority={lead.priority} /></td>
        <td><StatusBadge status={lead.status} /></td>
        <td>
          {lead.next_followup_date || '—'}
          {lead.followup_type === 'email' && (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, color: 'var(--orange)', fontSize: 11.5, fontWeight: 600 }}
              title={lead.email ? `Email ${lead.email}` : 'Email follow-up'}
            >
              <Mail size={12} /> Email
            </div>
          )}
          {lead.followup_type === 'call' && lead.next_followup_date && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, color: 'var(--text-faint)', fontSize: 11.5, fontWeight: 600 }}>
              <Phone size={12} /> Call
            </div>
          )}
        </td>
        <td>{lead.call_count}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} style={{ background: 'var(--bg-elev)' }}>
            <div style={{ padding: '12px 8px' }}>
              <OutcomePanel
                lead={lead}
                onSubmit={(outcome, date, note, extra) => onLogged(lead.id, outcome, date, note, extra)}
                onRoleChange={onRoleChange}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Quick "take the first N" buttons, scoped to a single section's list.
function PresetRow({ list, selected, onPick, onClear }) {
  const selectedInList = list.filter((l) => selected.has(l.id)).length;

  return (
    <div className="role-selector" style={{ marginBottom: 12, gap: 6 }}>
      <span className="role-selector-label">Take first:</span>
      {SELECT_PRESETS.map((n) => {
        const ids = list.slice(0, n).map((l) => l.id);
        const isActive = ids.length > 0
          && selectedInList === ids.length
          && ids.every((id) => selected.has(id));
        return (
          <button
            key={n}
            type="button"
            className={`role-btn${isActive ? ' active' : ''}`}
            disabled={list.length === 0}
            onClick={() => onPick(n)}
            title={n > list.length ? `Only ${list.length} here — selects all of them` : `Select the first ${n}`}
          >
            {n}
          </button>
        );
      })}
      {selectedInList > 0 && (
        <button type="button" className="role-btn" onClick={onClear}>
          Clear ({selectedInList})
        </button>
      )}
    </div>
  );
}

export default function Queue() {
  const [followups, setFollowups] = useState([]);
  const [fresh, setFresh] = useState([]);
  const [meta, setMeta] = useState({ priorities: [], cities: [], states: [], niches: [], statuses: [] });
  const [priority, setPriority] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [niche, setNiche] = useState('');
  const [country, setCountry] = useState('');
  const [campaign, setCampaign] = useState('');
  const [status, setStatus] = useState('New');
  // Weekend calling: on a Sat/Sun this defaults on, so you only ever see
  // businesses whose posted hours say they're open today.
  const [openOn, setOpenOn] = useState(() => {
    const dow = new Date().getDay(); // 0=Sun, 6=Sat
    return dow === 6 ? 'sat' : dow === 0 ? 'sun' : '';
  });
  // Leads sit across three US time zones while the calling happens from IST,
  // so "who can I reach right now" is a different question from "who's left".
  const [callableNow, setCallableNow] = useState(false);
  // Review count stands in for business size: few reviews usually means the
  // owner answers their own phone, many means staff and a gatekeeper.
  const [reviewBand, setReviewBand] = useState('');
  const [minRating, setMinRating] = useState('');
  // Scraped rows without an owner name usually mean the pitch has to fight
  // through a gatekeeper cold. Toggling to "Has owner" lets you burn through
  // the rows where you already know who to ask for.
  const [ownerFilter, setOwnerFilter] = useState('');
  const [websiteFilter, setWebsiteFilter] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [toast, setToast] = useState('');
  const [phoneFormat, setPhoneFormat] = useState(localStorage.getItem(PHONE_FORMAT_KEY) || 'e164');
  const navigate = useNavigate();
  const loadRequestId = useRef(0);

  useEffect(() => { api.meta().then(setMeta); }, []);
  useEffect(() => { load(); }, [priority, city, state, niche, status, openOn, callableNow, reviewBand, minRating, ownerFilter, country, campaign, websiteFilter]);

  // Local times drift while the page sits open — refresh so the clock column
  // and the "callable now" filter don't go stale mid-session.
  useEffect(() => {
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priority, city, state, niche, status, openOn, callableNow, reviewBand, minRating, ownerFilter, country, campaign, websiteFilter]);

  function load() {
    // Every filter change fires a new fetch, but nothing stopped an older,
    // slower response from resolving after a newer one and overwriting the
    // correctly-filtered result with stale data — e.g. toggling "Has owner
    // name" on could flash-then-revert to the unfiltered list if the
    // unfiltered request happened to still be in flight. Only the most
    // recently *started* request is allowed to update state.
    const requestId = ++loadRequestId.current;
    api.queueToday({ priority, city, state, niche, status, openOn, callableNow: callableNow ? '1' : '', reviewBand, minRating, ownerFilter, websiteFilter, country, campaign }).then((data) => {
      if (requestId !== loadRequestId.current) return;
      setFollowups(data.followups);
      setFresh(data.fresh);
      // A selection built from the old filter would silently carry leads that
      // are no longer on screen into the autodial list.
      setSelected(new Set());
    });
  }

  function setFormat(f) {
    setPhoneFormat(f);
    localStorage.setItem(PHONE_FORMAT_KEY, f);
  }

  const orderedQueue = useMemo(() => [...followups, ...fresh], [followups, fresh]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === orderedQueue.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orderedQueue.map((l) => l.id)));
    }
  }

  // Presets act on one section at a time and leave the other section's
  // selection alone — so you can take 10 follow-ups AND 30 from the filtered
  // pool in a single autodial list. Re-clicking the active preset clears just
  // that section.
  function selectFirstIn(list, n) {
    const listIds = list.map((l) => l.id);
    const pick = listIds.slice(0, n);
    setSelected((prev) => {
      const currentInList = listIds.filter((id) => prev.has(id));
      const sameSelection = pick.length === currentInList.length && pick.every((id) => prev.has(id));
      const next = new Set(prev);
      listIds.forEach((id) => next.delete(id));
      if (!sameSelection) pick.forEach((id) => next.add(id));
      return next;
    });
  }

  function clearIn(list) {
    const listIds = new Set(list.map((l) => l.id));
    setSelected((prev) => new Set([...prev].filter((id) => !listIds.has(id))));
  }

  async function handleLogged(leadId, outcome, date, note, extra) {
    const updated = await api.logCall(leadId, {
      outcome: outcome.label,
      next_followup_date: date,
      note_text: note,
      followup_type: extra?.followup_type ?? null,
      email: extra?.email ?? null,
      contact_role: extra?.contact_role ?? null,
      presented: extra?.presented ?? null,
      appointment_set: extra?.appointment_set ?? null,
    });
    if (updated && typeof updated.todayDials === 'number') maybeCelebrateDailyGoal(updated.todayDials);
    setExpandedId(null);
    load();
  }

  function copyAutodialList() {
    const selectedLeads = orderedQueue.filter((l) => selected.has(l.id));
    if (selectedLeads.length === 0) return;
    const text = selectedLeads.map((l) => formatPhone(l.phone, phoneFormat, l.country)).join('\n');
    localStorage.setItem('ccrm_session_ids', JSON.stringify(selectedLeads.map((l) => l.id)));
    // Primary path: hand the batch to the dialer extension via the server.
    // Clipboard stays as a fallback for manual pasting; neither failing
    // should strand the user on this screen.
    const entries = selectedLeads.map((l) => ({
      number: formatPhone(l.phone, 'e164', l.country),
      label: l.business_name || l.contact_name || '',
    }));
    navigator.clipboard.writeText(text).catch(() => {});
    api.sendToDialer(entries)
      .then(() => setToast(`${selectedLeads.length} leads sent to dialer — hit "Load from CRM" in the extension`))
      .catch(() => setToast(`${selectedLeads.length} numbers copied — paste into Auto Dialer list`))
      .finally(() => {
        setTimeout(() => setToast(''), 3500);
        setTimeout(() => navigate('/session'), 600);
      });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Today's Queue</h1>
          <div className="page-header-sub">Follow-ups due, then fresh leads — select who to call and build an autodial list.</div>
        </div>
      </div>

      <div className="toolbar">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          title="Which pool of leads to work through (does not affect follow-ups due)"
        >
          {(meta.statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">All priorities</option>
          {meta.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">All states</option>
          {(meta.states || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Any country</option>
          <option value="US">USA</option>
          <option value="AU">Australia</option>
        </select>
        <select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="">Any campaign</option>
          {meta?.campaigns?.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">All cities</option>
          {meta.cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={niche} onChange={(e) => setNiche(e.target.value)} title="Work one vertical at a time so the pitch stays consistent">
          <option value="">All niches</option>
          {(meta.niches || []).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select
          value={reviewBand}
          onChange={(e) => setReviewBand(e.target.value)}
          title="Google review count — a rough proxy for business size. Fewer reviews usually means the owner answers directly."
        >
          <option value="">Any reviews</option>
          {(meta.reviewBands || []).map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          <option value="unknown">No review data</option>
        </select>
        <select
          value={minRating}
          onChange={(e) => setMinRating(e.target.value)}
          title="Minimum Google star rating. Leads with no rating on file are excluded when this is set."
        >
          <option value="">Any rating</option>
          <option value="4.8">4.8+ stars</option>
          <option value="4.5">4.5+ stars</option>
          <option value="4">4.0+ stars</option>
        </select>
        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          title="Filter by whether the scrape captured an owner name for the business."
        >
          <option value="">Any owner</option>
          <option value="has">Has owner name</option>
          <option value="blank">No owner name</option>
        </select>
        <select
          value={websiteFilter}
          onChange={(e) => setWebsiteFilter(e.target.value)}
          title="Filter by whether the business has a website on file."
        >
          <option value="">Any website</option>
          <option value="has">Has website</option>
          <option value="blank">No website</option>
        </select>
        <label
          className="autodial-toggle"
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-dim)', cursor: 'pointer' }}
          title="Only businesses where it's currently 9am-5pm local. Leads with no state have no local time and are excluded."
        >
          <input type="checkbox" checked={callableNow} onChange={(e) => setCallableNow(e.target.checked)} />
          Callable now
        </label>
        <select
          value={openOn}
          onChange={(e) => setOpenOn(e.target.value)}
          title="Only show businesses whose posted hours say they're open that day. Leads with no hours data are excluded."
        >
          <option value="">Open any day</option>
          <option value="sat">Open Saturdays</option>
          <option value="sun">Open Sundays</option>
        </select>

        <span style={{ marginLeft: 'auto' }} />
        <select value={phoneFormat} onChange={(e) => setFormat(e.target.value)} title="Format used when copying numbers">
          <option value="e164">+1XXXXXXXXXX</option>
          <option value="plain10">XXXXXXXXXX</option>
        </select>
        <button className="btn btn-primary" disabled={selected.size === 0} onClick={copyAutodialList}>
          <Copy size={15} />Copy Autodial List ({selected.size})
        </button>
      </div>

      {openOn && (
        <div className="card" style={{ marginBottom: 16, color: 'var(--text-dim)', fontSize: 12.5 }}>
          Showing only businesses whose posted hours say they're open on{' '}
          <strong style={{ color: 'var(--text)' }}>{openOn === 'sat' ? 'Saturday' : 'Sunday'}</strong>.
          Leads with no hours data on file are hidden — that's most of the older imports, so this list
          will be much shorter than a weekday queue.
        </div>
      )}

      <h2>Follow-ups Due ({followups.length})</h2>
      <PresetRow
        list={followups}
        selected={selected}
        onPick={(n) => selectFirstIn(followups, n)}
        onClear={() => clearIn(followups)}
      />
      <div className="card" style={{ marginBottom: 24, padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th className="checkbox-cell"><input type="checkbox" checked={selected.size === orderedQueue.length && orderedQueue.length > 0} onChange={toggleAll} /></th>
              <th>Business</th><th>Contact</th><th>Phone</th><th>City</th><th>Local</th><th>Priority</th><th>Status</th><th>Follow-up</th><th>Calls</th>
            </tr>
          </thead>
          <tbody>
            {followups.length === 0 && <tr><td colSpan={10} className="empty-state">No overdue or due-today follow-ups. Nice.</td></tr>}
            {followups.map((l) => (
              <LeadRow key={l.id} lead={l} checked={selected.has(l.id)} onToggle={toggle}
                expanded={expandedId === l.id} onExpand={setExpandedId} onLogged={handleLogged} onRoleChange={load} />
            ))}
          </tbody>
        </table>
      </div>

      <h2>{status === 'New' ? 'Fresh New Leads' : `${status} Leads`} ({fresh.length})</h2>
      <PresetRow
        list={fresh}
        selected={selected}
        onPick={(n) => selectFirstIn(fresh, n)}
        onClear={() => clearIn(fresh)}
      />
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th className="checkbox-cell"></th>
              <th>Business</th><th>Contact</th><th>Phone</th><th>City</th><th>Local</th><th>Priority</th><th>Status</th><th>Follow-up</th><th>Calls</th>
            </tr>
          </thead>
          <tbody>
            {fresh.length === 0 && <tr><td colSpan={10} className="empty-state">No “{status}” leads matching this filter.</td></tr>}
            {fresh.map((l) => (
              <LeadRow key={l.id} lead={l} checked={selected.has(l.id)} onToggle={toggle}
                expanded={expandedId === l.id} onExpand={setExpandedId} onLogged={handleLogged} onRoleChange={load} />
            ))}
          </tbody>
        </table>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
