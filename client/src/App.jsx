import { useState } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import {
  LayoutDashboard, ListChecks, Phone, Users, Columns3, Upload, Settings as SettingsIcon, BarChart3,
  PanelLeftClose, PanelLeftOpen, Filter, Mic
} from 'lucide-react'
import Dashboard from './pages/Dashboard.jsx'
import Queue from './pages/Queue.jsx'
import Session from './pages/Session.jsx'
import Practice from './pages/Practice.jsx'
import Kanban from './pages/Kanban.jsx'
import Leads from './pages/Leads.jsx'
import Import from './pages/Import.jsx'
import Settings from './pages/Settings.jsx'
import Analytics from './pages/Analytics.jsx'
import Funnel from './pages/Funnel.jsx'
import ThemeToggle from './components/ThemeToggle.jsx'
import BalanceIndicator from './components/BalanceIndicator.jsx'

const NAV_ITEMS = [
  { to: '/', end: true, label: 'Dashboard', icon: LayoutDashboard },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/funnel', label: 'Funnel', icon: Filter },
  { to: '/queue', label: "Today's Queue", icon: ListChecks },
  { to: '/session', label: 'Active Session', icon: Phone },
  { to: '/practice', label: 'Practice', icon: Mic },
  { to: '/leads', label: 'All Leads', icon: Users },
  { to: '/kanban', label: 'Pipeline', icon: Columns3 },
  { to: '/import', label: 'Import CSV', icon: Upload },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

const SIDEBAR_COLLAPSED_KEY = 'ccrm_sidebar_collapsed'

function App() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')

  function toggleSidebar() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }

  return (
    <div className={`app${collapsed ? ' sidebar-collapsed' : ''}`}>
      <nav className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">CC</div>
          <div className="sidebar-brand-text">
            <strong>Cold Call CRM</strong>
            <small>Your Company — Cold Outreach</small>
          </div>
          <button className="sidebar-collapse-btn" onClick={toggleSidebar} title="Hide sidebar">
            <PanelLeftClose size={16} />
          </button>
        </div>
        <div className="sidebar-nav">
          {NAV_ITEMS.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </div>
        <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <BalanceIndicator />
          <ThemeToggle />
        </div>
      </nav>
      {collapsed && (
        <button className="sidebar-expand-btn" onClick={toggleSidebar} title="Show sidebar">
          <PanelLeftOpen size={16} />
        </button>
      )}
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/funnel" element={<Funnel />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/session" element={<Session />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/kanban" element={<Kanban />} />
          <Route path="/import" element={<Import />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
