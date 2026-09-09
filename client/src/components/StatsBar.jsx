import { PhoneCall, CalendarRange, TrendingUp, CalendarCheck } from 'lucide-react';

export default function StatsBar({ stats }) {
  if (!stats) return null;
  const items = [
    { label: 'Calls Today', value: stats.callsToday, icon: PhoneCall },
    { label: 'Calls This Week', value: stats.callsWeek, icon: CalendarRange },
    { label: 'Connect Rate (Week)', value: `${stats.connectRate}%`, icon: TrendingUp },
    { label: 'Demos Booked (Week)', value: stats.demosWeek, icon: CalendarCheck },
  ];
  return (
    <div className="stats-bar">
      {items.map(({ label, value, icon: Icon }) => (
        <div key={label} className="stat-box">
          <div className="stat-icon"><Icon size={17} /></div>
          <div>
            <div className="value">{value}</div>
            <div className="label">{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
