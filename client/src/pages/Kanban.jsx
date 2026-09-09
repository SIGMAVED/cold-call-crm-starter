import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useSettings } from '../SettingsContext.jsx';
import { telHref } from '../phone.js';

export default function Kanban() {
  const [board, setBoard] = useState(null);
  const { statuses } = useSettings();

  useEffect(() => { api.kanban().then(setBoard); }, []);

  if (!board) return <div className="empty-state">Loading…</div>;

  return (
    <div>
      <div className="page-header"><h1>Pipeline</h1></div>
      <div className="kanban-board">
        {statuses.map(({ name: status }) => (
          <div key={status} className="kanban-col">
            <h3>{status} <span>{(board[status] || []).length}</span></h3>
            <div className="kanban-cards">
              {(board[status] || []).map((l) => (
                <div key={l.id} className="kanban-card">
                  <div className="biz">{l.business_name || 'Unnamed'}</div>
                  <div className="phone"><a href={telHref(l.phone, l.country)}>{l.phone}</a></div>
                  {l.next_followup_date && <div style={{ marginTop: 4, color: 'var(--text-dim)' }}>Follow-up: {l.next_followup_date}</div>}
                </div>
              ))}
              {(board[status] || []).length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>—</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
