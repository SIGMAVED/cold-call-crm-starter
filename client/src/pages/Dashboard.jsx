import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Columns3 } from 'lucide-react';
import { api } from '../api.js';
import { PriorityBadge } from '../components/Badges.jsx';
import StatsBar from '../components/StatsBar.jsx';
import DailyFunnelCard from '../components/DailyFunnelCard.jsx';

function ReminderList({ leads }) {
  if (leads.length === 0) return <div className="empty-state">Nothing here.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {leads.map((l) => (
        <div key={l.id} className="card" style={{ padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{l.business_name || 'Unnamed'}</strong>
            <PriorityBadge priority={l.priority} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
            {l.contact_name && `${l.contact_name} · `}{l.phone} {l.city && `· ${l.city}`}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
            Follow up: {l.next_followup_date}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [followups, setFollowups] = useState({ overdue: [], dueToday: [], upcoming: [] });

  useEffect(() => {
    api.stats().then(setStats);
    fetchFollowups();
  }, []);

  function fetchFollowups() {
    api.dashboardFollowups().then(setFollowups);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <div className="page-header-sub">Today's calling picture, at a glance.</div>
        </div>
      </div>
      <DailyFunnelCard />
      <StatsBar stats={stats} />

      <div className="reminders-grid">
        <div className="reminder-col">
          <h2><span className="dot dot-red" /> Overdue ({followups.overdue.length})</h2>
          <ReminderList leads={followups.overdue} />
        </div>
        <div className="reminder-col">
          <h2><span className="dot dot-orange" /> Due Today ({followups.dueToday.length})</h2>
          <ReminderList leads={followups.dueToday} />
        </div>
        <div className="reminder-col">
          <h2><span className="dot dot-green" /> Upcoming This Week ({followups.upcoming.length})</h2>
          <ReminderList leads={followups.upcoming} />
        </div>
      </div>

      <div className="toolbar">
        <Link to="/queue" className="btn btn-primary btn-lg">Start Tonight's Queue<ArrowRight size={16} /></Link>
        <Link to="/kanban" className="btn"><Columns3 size={15} />View Pipeline</Link>
      </div>
    </div>
  );
}
