import { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, Clock, CheckCircle2, ChevronRight, RefreshCw, Trophy } from 'lucide-react';
import { SCRIPT } from '../constants.js';
import BarChart from '../components/BarChart.jsx';

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const getTodayKey = () => {
  const d = new Date();
  return `ccrm_practice_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getStorageData = () => {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('ccrm_practice_')) {
      try {
        data[key] = JSON.parse(localStorage.getItem(key));
      } catch (e) { }
    }
  }
  return data;
};

const saveTodayData = (updates) => {
  const key = getTodayKey();
  let today = { date: key.split('_')[2], objections: 0, asks: 0, fullRuns: 0 };
  try {
    const existing = localStorage.getItem(key);
    if (existing) today = { ...today, ...JSON.parse(existing) };
  } catch (e) {}
  today = { ...today, ...updates };
  localStorage.setItem(key, JSON.stringify(today));
  return today;
};

export default function Practice() {
  const [tab, setTab] = useState('objections');
  const [sessionSecs, setSessionSecs] = useState(0);
  const [stats, setStats] = useState(() => saveTodayData({}));
  
  useEffect(() => {
    const timer = setInterval(() => setSessionSecs(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleStatUpdate = (key) => {
    const updated = saveTodayData({ [key]: (stats[key] || 0) + 1 });
    setStats(updated);
  };

  const chartData = [];
  const allData = getStorageData();
  const d = new Date();
  for (let i = 6; i >= 0; i--) {
    const past = new Date(d);
    past.setDate(d.getDate() - i);
    const dateStr = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
    const key = `ccrm_practice_${dateStr}`;
    const dayData = allData[key] || { objections: 0, asks: 0, fullRuns: 0 };
    const total = dayData.objections + dayData.asks + dayData.fullRuns;
    chartData.push({
      label: past.toLocaleDateString('en-US', { weekday: 'short' }),
      fullLabel: past.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: total
    });
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', paddingBottom: 40 }}>
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1>Practice Mode</h1>
          <div className="page-header-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Mic size={13} /> Verbally drill your script
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="page-header-sub" style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', fontWeight: 600, color: sessionSecs >= 1800 ? 'var(--green)' : 'var(--text-dim)' }}>
            <Clock size={13} /> {formatTime(sessionSecs)} elapsed
          </div>
          <div className="page-header-sub" style={{ fontSize: 11.5 }}>
            Target: 30:00 - 40:00
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, borderBottom: '1px solid var(--border)' }}>
        <button className={`nav-link${tab === 'objections' ? ' active' : ''}`} style={{ border: 'none', background: 'none', cursor: 'pointer', paddingBottom: 10, borderRadius: 0, borderBottom: tab === 'objections' ? '2px solid var(--accent)' : '2px solid transparent' }} onClick={() => setTab('objections')}>Objection Drill</button>
        <button className={`nav-link${tab === 'asks' ? ' active' : ''}`} style={{ border: 'none', background: 'none', cursor: 'pointer', paddingBottom: 10, borderRadius: 0, borderBottom: tab === 'asks' ? '2px solid var(--accent)' : '2px solid transparent' }} onClick={() => setTab('asks')}>The Ask Drill</button>
        <button className={`nav-link${tab === 'full' ? ' active' : ''}`} style={{ border: 'none', background: 'none', cursor: 'pointer', paddingBottom: 10, borderRadius: 0, borderBottom: tab === 'full' ? '2px solid var(--accent)' : '2px solid transparent' }} onClick={() => setTab('full')}>Full Sequence</button>
      </div>

      <div className="card" style={{ minHeight: 300, display: 'flex', flexDirection: 'column' }}>
        {tab === 'objections' && <ObjectionDrill onComplete={() => handleStatUpdate('objections')} />}
        {tab === 'asks' && <AskDrill onComplete={() => handleStatUpdate('asks')} />}
        {tab === 'full' && <FullSequenceDrill onComplete={() => handleStatUpdate('fullRuns')} />}
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 24 }}>
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.05em' }}>Today's Objections</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>{stats.objections}</div>
        </div>
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.05em' }}>Today's Asks</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>{stats.asks}</div>
        </div>
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.05em' }}>Full Runs</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>{stats.fullRuns}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: 14 }}>Last 7 Days (Total Reps)</h3>
        <BarChart data={chartData} unitLabel="reps" />
      </div>
    </div>
  );
}

function ObjectionDrill({ onComplete }) {
  const [currentIndex, setCurrentIndex] = useState(() => Math.floor(Math.random() * SCRIPT.objections.length));
  const [showResponse, setShowResponse] = useState(false);

  const next = useCallback(() => {
    let nextIdx = Math.floor(Math.random() * SCRIPT.objections.length);
    while (nextIdx === currentIndex && SCRIPT.objections.length > 1) {
      nextIdx = Math.floor(Math.random() * SCRIPT.objections.length);
    }
    setCurrentIndex(nextIdx);
    setShowResponse(false);
    onComplete();
  }, [currentIndex, onComplete]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (!showResponse) setShowResponse(true);
        else next();
      } else if (showResponse && (e.key === '1' || e.key === '2')) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showResponse, next]);

  const obj = SCRIPT.objections[currentIndex];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 24 }}>Respond out loud</div>
      
      <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 32, lineHeight: 1.4 }}>"{obj.trigger}"</div>
      
      {showResponse ? (
        <div style={{ width: '100%' }}>
          <div style={{ fontSize: 18, color: 'var(--accent)', marginBottom: 40, fontStyle: 'italic', lineHeight: 1.4 }}>"{obj.response}"</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <button className="btn" onClick={next} style={{ flex: 1, maxWidth: 200 }}>
              <span style={{ opacity: 0.5, marginRight: 6 }}>[1]</span> Shaky
            </button>
            <button className="btn btn-primary" onClick={next} style={{ flex: 1, maxWidth: 200 }}>
              <span style={{ opacity: 0.5, marginRight: 6 }}>[2]</span> Confident
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={() => setShowResponse(true)}>
          <span style={{ opacity: 0.5, marginRight: 6 }}>[Space]</span> Show Response
        </button>
      )}
    </div>
  );
}

function AskDrill({ onComplete }) {
  const [askVariant, setAskVariant] = useState(() => Math.floor(Math.random() * SCRIPT.ask.length));
  const [objection, setObjection] = useState(() => SCRIPT.objections[Math.floor(Math.random() * SCRIPT.objections.length)]);
  
  const next = useCallback(() => {
    setAskVariant(Math.floor(Math.random() * SCRIPT.ask.length));
    setObjection(SCRIPT.objections[Math.floor(Math.random() * SCRIPT.objections.length)]);
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === '1' || e.key === '2') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [next]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 24 }}>Pitch the Ask (Out Loud)</div>
      
      <div style={{ background: 'var(--bg-inset)', padding: '16px 24px', borderRadius: 8, marginBottom: 32, width: '100%', maxWidth: 500 }}>
        <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 8 }}>Scenario:</div>
        <div style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.4 }}>
          Owner confirms it's them. They mention: <strong>"{objection.trigger}"</strong>
        </div>
      </div>
      
      <div style={{ fontSize: 18, color: 'var(--accent)', marginBottom: 40, fontStyle: 'italic', lineHeight: 1.4 }}>
        "{SCRIPT.ask[askVariant]}"
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, width: '100%' }}>
        <button className="btn" onClick={next} style={{ flex: 1, maxWidth: 200 }}>
          <span style={{ opacity: 0.5, marginRight: 6 }}>[1]</span> Shaky
        </button>
        <button className="btn btn-primary" onClick={next} style={{ flex: 1, maxWidth: 200 }}>
          <span style={{ opacity: 0.5, marginRight: 6 }}>[2]</span> Confident
        </button>
      </div>
    </div>
  );
}

function FullSequenceDrill({ onComplete }) {
  const [step, setStep] = useState(0); // 0=Opener, 1=Qualify, 2=Ask, 3=Objection, 4=Lock-in
  const [objection] = useState(() => SCRIPT.objections[Math.floor(Math.random() * SCRIPT.objections.length)]);
  const [startTime, setStartTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  const nextStep = useCallback(() => {
    if (step < 4) {
      setStep(s => s + 1);
    } else {
      onComplete();
      setStep(0);
      setStartTime(Date.now());
      setElapsed(0);
    }
  }, [step, onComplete]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        nextStep();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextStep]);

  const steps = [
    { label: 'Opener (Ladder)', content: SCRIPT.opener.join('\n\n') },
    { label: 'Qualify', content: SCRIPT.qualify },
    { label: 'The Ask', content: SCRIPT.ask[0] },
    { label: `Objection: "${objection.trigger}"`, content: objection.response },
    { label: 'Lock In', content: SCRIPT.lockIn }
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.05em' }}>Full Sequence</div>
        <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'monospace' }}>{formatTime(elapsed)}</div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
        {[0, 1, 2, 3, 4].map(s => (
          <div key={s} style={{ height: 4, flex: 1, borderRadius: 2, background: s <= step ? 'var(--accent)' : 'var(--bg-inset)' }} />
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 12 }}>{steps[step].label}</div>
        <div style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          "{steps[step].content}"
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 32 }}>
        <button className="btn btn-primary" onClick={nextStep}>
          <span style={{ opacity: 0.5, marginRight: 6 }}>[Space]</span> {step === 4 ? 'Finish Run' : 'Next Step'}
        </button>
      </div>
    </div>
  );
}
