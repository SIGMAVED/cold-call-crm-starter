import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { api } from '../api.js';

const POLL_MS = 60 * 1000;
// Calls run ~$0.017-0.018/min all-in (see CLAUDE.md) — below this, a single
// session could exhaust the balance mid-call, so flag it before that happens.
const LOW_BALANCE_THRESHOLD = 5;

export default function BalanceIndicator() {
  const [balance, setBalance] = useState(null);
  const [usage, setUsage] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api.twilioBalance()
        .then((data) => { if (!cancelled) { setBalance(data); setFailed(false); } })
        .catch(() => { if (!cancelled) setFailed(true); });
      api.twilioUsage()
        .then((data) => { if (!cancelled) setUsage(data); })
        .catch(() => {});
    }
    load();
    const t = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (failed) return null;

  const low = balance && balance.balance < LOW_BALANCE_THRESHOLD;

  return (
    <div>
      <div
        className="theme-toggle"
        style={low ? { color: 'var(--red)', borderColor: 'var(--red)' } : undefined}
        title={low ? 'Twilio balance is low — calls may fail mid-session' : `Twilio balance ($${balance?.balance.toFixed(2)} USD @ ₹${balance?.fxRate})`}
      >
        <Wallet size={16} />
        {balance ? `₹${balance.inr.toFixed(2)}` : 'Balance —'}
      </div>
      {usage && (
        <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '4px 13px 0', display: 'flex', justifyContent: 'space-between' }}>
          <span>Today ₹{usage.today.inr.toFixed(2)}</span>
          <span>All-time ₹{usage.allTime.inr.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
