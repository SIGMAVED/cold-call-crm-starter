import { Fragment, useEffect, useRef, useState } from 'react';
import { Search, Trash2, Columns3, ArrowUp, ArrowDown, Check } from 'lucide-react';
import { api } from '../api.js';
import { PriorityBadge, StatusBadge } from '../components/Badges.jsx';
import LeadEditForm from '../components/LeadEditForm.jsx';
import LocalTime from '../components/LocalTime.jsx';
import { telHref, withHttp, prettyUrl } from '../phone.js';

const COLUMNS_KEY = 'ccrm_leads_columns';
const SORT_KEY = 'ccrm_leads_sort';

// Every column the table can show. `render` keeps the cell markup with the
// column definition, so adding a column never means touching the table body.
const ALL_COLUMNS = [
  { key: 'business_name', label: 'Business', render: (l) => l.business_name || <em style={{ color: 'var(--text-dim)' }}>Unnamed</em> },
  { key: 'contact_name', label: 'Contact', render: (l) => l.contact_name },
  { key: 'owner_name', label: 'Owner', render: (l) => l.owner_name || '—' },
  { key: 'phone', label: 'Phone', stopClick: true, render: (l) => <a href={telHref(l.phone, l.country)}>{l.phone}</a> },
  { key: 'email', label: 'Email', stopClick: true, render: (l) => (l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : '—') },
  { key: 'website', label: 'Website', stopClick: true, render: (l) => (l.website ? <a href={withHttp(l.website)} target="_blank" rel="noreferrer">{prettyUrl(l.website)}</a> : '—') },
  { key: 'google_maps_url', label: 'Google Maps', stopClick: true, render: (l) => (l.google_maps_url ? <a href={l.google_maps_url} target="_blank" rel="noreferrer">Open</a> : '—') },
  { key: 'working_hours', label: 'Working Hours', render: (l) => l.working_hours || '—' },
  { key: 'city', label: 'City', render: (l) => l.city },
  { key: 'state', label: 'State', render: (l) => l.state || '—' },
  { key: 'local_time', label: 'Local Time', render: (l) => <LocalTime local={l.local} /> },
  { key: 'niche', label: 'Niche', render: (l) => l.niche || '—' },
  { key: 'source', label: 'Source', render: (l) => l.source },
  { key: 'priority', label: 'Priority', render: (l) => <PriorityBadge priority={l.priority} /> },
  { key: 'status', label: 'Status', render: (l) => <StatusBadge status={l.status} /> },
  { key: 'role', label: 'Role', render: (l) => l.role || '—' },
  { key: 'next_followup_date', label: 'Follow-up', render: (l) => l.next_followup_date || '—' },
  { key: 'followup_type', label: 'Follow-up Via', render: (l) => (l.followup_type ? l.followup_type[0].toUpperCase() + l.followup_type.slice(1) : '—') },
  { key: 'last_contact_date', label: 'Last Contact', render: (l) => l.last_contact_date || '—' },
  { key: 'call_count', label: 'Calls', render: (l) => l.call_count },
  { key: 'review_count', label: 'Reviews', render: (l) => (l.review_count ?? '—') },
  { key: 'rating', label: 'Rating', render: (l) => (l.rating ?? '—') },
  { key: 'lead_score', label: 'Score', render: (l) => (l.lead_score ?? '—') },
  {
    key: 'missed_call_evidence',
    label: 'Misses Calls',
    render: (l) => (l.missed_call_evidence
      ? <span className="badge badge-warn" title={l.missed_call_evidence}>evidence</span>
      : '—'),
  },
  { key: 'created_at', label: 'Added', render: (l) => (l.created_at || '').slice(0, 10) },
];

const DEFAULT_VISIBLE = [
  'business_name', 'contact_name', 'phone', 'city', 'priority', 'status', 'next_followup_date', 'call_count',
];

function loadVisible() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY));
    // Drop any keys from an older build that no longer exist.
    if (Array.isArray(saved) && saved.length) {
      const valid = saved.filter((k) => ALL_COLUMNS.some((c) => c.key === k));
      if (valid.length) return valid;
    }
  } catch { /* fall through to defaults */ }
  return DEFAULT_VISIBLE;
}

function loadSort() {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY));
    if (saved?.sort) return saved;
  } catch { /* fall through */ }
  return { sort: 'created_at', dir: 'desc' };
}

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [meta, setMeta] = useState({ statuses: [], priorities: [], cities: [], states: [], niches: [], sources: [] });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [niche, setNiche] = useState('');
  const [source, setSource] = useState('');
  const [country, setCountry] = useState('');
  const [campaign, setCampaign] = useState('');
  const [followupType, setFollowupType] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [websiteFilter, setWebsiteFilter] = useState('');
  const [dialedFrom, setDialedFrom] = useState('');
  const [dialedTo, setDialedTo] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [selected, setSelected] = useState(new Set());

  const [visibleKeys, setVisibleKeys] = useState(loadVisible);
  const [{ sort, dir }, setSortState] = useState(loadSort);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(null);

  // When the rep is looking at follow-ups, the call/email split is the whole
  // point — surface the "Follow-up Via" column automatically without touching
  // their saved column choices.
  const followupContext = followupType !== '' || status === 'Follow-Up Scheduled';
  const effectiveKeys = followupContext && !visibleKeys.includes('followup_type')
    ? [...visibleKeys, 'followup_type']
    : visibleKeys;
  const columns = ALL_COLUMNS.filter((c) => effectiveKeys.includes(c.key));
  const colSpan = columns.length + 1;

  useEffect(() => { api.meta().then(setMeta); }, []);

  useEffect(() => {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(visibleKeys));
  }, [visibleKeys]);

  useEffect(() => {
    localStorage.setItem(SORT_KEY, JSON.stringify({ sort, dir }));
  }, [sort, dir]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, priority, city, state, niche, source, followupType, ownerFilter, dialedFrom, dialedTo, sort, dir, country, websiteFilter, campaign]);

  // Close the column picker on an outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  function load() {
    api.listLeads({ search, status, priority, city, state, niche, source, followupType, ownerFilter, websiteFilter, dialedFrom, dialedTo, sort, dir, country, campaign }).then((rows) => {
      setLeads(rows);
      setSelected(new Set());
    });
  }

  // First click sorts ascending; clicking the active column flips direction.
  function toggleSort(key) {
    setSortState((prev) => (
      prev.sort === key
        ? { sort: key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { sort: key, dir: 'asc' }
    ));
  }

  function toggleColumn(key) {
    setVisibleKeys((prev) => {
      if (prev.includes(key)) {
        // Never let the table become headerless.
        if (prev.length === 1) return prev;
        return prev.filter((k) => k !== key);
      }
      // Keep the canonical ALL_COLUMNS order regardless of click order.
      return ALL_COLUMNS.filter((c) => prev.includes(c.key) || c.key === key).map((c) => c.key);
    });
  }

  function setDialedToday() {
    const today = new Date().toISOString().slice(0, 10);
    setDialedFrom(today);
    setDialedTo(today);
  }

  function clearDialedFilter() {
    setDialedFrom('');
    setDialedTo('');
  }

  function handleSaved(updated) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
  }

  function handleDeleted(id) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    setExpandedId((prev) => (prev === id ? null : prev));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === leads.length ? new Set() : new Set(leads.map((l) => l.id))));
  }

  function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} selected lead${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    api.bulkDeleteLeads([...selected]).then(() => {
      setLeads((prev) => prev.filter((l) => !selected.has(l.id)));
      setExpandedId((prev) => (selected.has(prev) ? null : prev));
      setSelected(new Set());
    });
  }

  return (
    <div>
      <div className="page-header"><h1>All Leads ({leads.length})</h1></div>

      <div className="toolbar">
        <div className="input-icon-wrap">
          <Search size={14} />
          <input placeholder="Search business, contact, or phone…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 260 }} />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {meta.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">All priorities</option>
          {meta.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">All states</option>
          {meta.states.map((s) => <option key={s} value={s}>{s}</option>)}
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
        <select value={niche} onChange={(e) => setNiche(e.target.value)}>
          <option value="">All niches</option>
          {meta.niches.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {meta.sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={followupType}
          onChange={(e) => setFollowupType(e.target.value)}
          title="Split scheduled follow-ups into calls vs emails"
        >
          <option value="">Any follow-up</option>
          <option value="call">Call follow-up</option>
          <option value="email">Email follow-up</option>
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
        <span style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>Dialed</span>
        <input type="date" value={dialedFrom} onChange={(e) => setDialedFrom(e.target.value)} title="Dialed from" />
        <span style={{ color: 'var(--text-faint)' }}>–</span>
        <input type="date" value={dialedTo} onChange={(e) => setDialedTo(e.target.value)} title="Dialed to" />
        <button className="btn" onClick={setDialedToday}>Today</button>
        {(dialedFrom || dialedTo) && <button className="btn" onClick={clearDialedFilter}>Clear</button>}

        <div ref={pickerRef} style={{ position: 'relative', marginLeft: 'auto' }}>
          <button className="btn" onClick={() => setPickerOpen((o) => !o)} title="Choose which columns to show">
            <Columns3 size={14} /> Columns ({columns.length})
          </button>
          {pickerOpen && (
            <div
              className="card"
              style={{
                position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 100,
                width: 220, padding: 8, maxHeight: 360, overflowY: 'auto',
              }}
            >
              {ALL_COLUMNS.map((c) => {
                const on = visibleKeys.includes(c.key);
                return (
                  <button
                    key={c.key}
                    onClick={() => toggleColumn(c.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      background: 'transparent', border: 'none', textAlign: 'left',
                      padding: '7px 9px', borderRadius: 8, fontSize: 13,
                      color: on ? 'var(--text)' : 'var(--text-dim)',
                    }}
                  >
                    <span style={{ width: 14, display: 'inline-flex', color: 'var(--accent)' }}>
                      {on && <Check size={14} />}
                    </span>
                    {c.label}
                  </button>
                );
              })}
              <button
                className="btn"
                style={{ width: '100%', marginTop: 6, justifyContent: 'center' }}
                onClick={() => setVisibleKeys(DEFAULT_VISIBLE)}
              >
                Reset to default
              </button>
            </div>
          )}
        </div>

        {selected.size > 0 && (
          <button className="btn btn-danger" onClick={handleBulkDelete}>
            <Trash2 size={14} /> Delete {selected.size} Selected
          </button>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th className="checkbox-cell">
                <input type="checkbox" checked={leads.length > 0 && selected.size === leads.length} onChange={toggleAll} />
              </th>
              {columns.map((c) => {
                const active = sort === c.key;
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                    title={`Sort by ${c.label}`}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: active ? 'var(--accent)' : undefined }}>
                      {c.label}
                      {active && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && <tr><td colSpan={colSpan} className="empty-state">No leads match these filters.</td></tr>}
            {leads.map((l) => (
              <Fragment key={l.id}>
                <tr onClick={() => setExpandedId(expandedId === l.id ? null : l.id)} style={{ cursor: 'pointer' }}>
                  <td className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} />
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} onClick={c.stopClick ? (e) => e.stopPropagation() : undefined}>
                      {c.render(l)}
                    </td>
                  ))}
                </tr>
                {expandedId === l.id && (
                  <tr>
                    <td colSpan={colSpan} style={{ background: 'var(--bg-elev)' }}>
                      <div style={{ padding: '14px 8px' }}>
                        <LeadEditForm lead={l} onSaved={handleSaved} onDeleted={handleDeleted} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
