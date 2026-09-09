import { Router } from 'express';
import { db } from '../db/init.js';
import { dialFilterSql } from './analytics.js';

const router = Router();

// The four-stage funnel. Each rate is measured against the stage above it, so
// a low rate points at one specific failure rather than a blended "it's bad".
const TARGETS = {
  ownerRate: { min: 8, good: 12, label: 'Owner rate', diagnosis: 'lead quality — the lists are not putting decision-makers on the phone' },
  presentationRate: { min: 50, good: 50, label: 'Presentation rate', diagnosis: 'not completing the pitch — reaching owners but not getting through to an ask' },
  appointmentRate: { min: 20, good: 20, label: 'Appointment rate', diagnosis: 'closing / objection handling — pitching but not converting to a booking' },
};

// Below this a rate is noise, not signal. Segments under it are returned with
// `thin: true` so the UI can grey them out instead of inviting action on a
// 9-lead bucket.
const MIN_N = 30;

function todayStr() { return new Date().toISOString().slice(0, 10); }

function dateRange(req) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : '1970-01-01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : todayStr();
  return { from, to };
}

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

// Wilson score interval — behaves sensibly at small n and near 0%/100%, where
// the textbook normal approximation produces impossible bounds like -3%.
function wilson(successes, total, z = 1.96) {
  if (!total) return { low: 0, high: 0 };
  const p = successes / total;
  const d = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return {
    low: Math.max(0, Math.round(((centre - spread) / d) * 1000) / 10),
    high: Math.min(100, Math.round(((centre + spread) / d) * 1000) / 10),
  };
}

function rate(successes, total, targetKey) {
  const t = TARGETS[targetKey];
  const value = pct(successes, total);
  const ci = wilson(successes, total);
  // Judge against the target using the CI, not the point estimate: if the
  // interval still straddles the target the data can't yet say it's below.
  let status = 'unknown';
  if (total >= MIN_N) {
    if (ci.low >= t.min) status = 'good';
    else if (ci.high < t.min) status = 'below';
    else status = 'uncertain';
  }
  return { value, successes, total, ci, target: t.min, targetLabel: t.good === t.min ? `${t.min}%+` : `${t.min}-${t.good}%`, status, thin: total < MIN_N };
}

// One row per disposition, with the funnel flags resolved.
const BASE = `
  FROM notes n
  LEFT JOIN leads l ON l.id = n.lead_id
  WHERE ${dialFilterSql('n')} AND date(n.created_at) BETWEEN ? AND ?
`;

function funnelCounts(where = '', params = []) {
  const row = db.prepare(`
    SELECT
      COUNT(*) dials,
      SUM(CASE WHEN n.contact_role = 'owner' THEN 1 ELSE 0 END) owners,
      SUM(CASE WHEN n.presented = 1 THEN 1 ELSE 0 END) presentations,
      SUM(CASE WHEN n.appointment_set = 1 THEN 1 ELSE 0 END) appointments,
      SUM(CASE WHEN n.contact_role IS NULL THEN 1 ELSE 0 END) roleMissing
    ${BASE} ${where}
  `).get(...params);
  return {
    dials: row.dials || 0,
    owners: row.owners || 0,
    presentations: row.presentations || 0,
    appointments: row.appointments || 0,
    roleMissing: row.roleMissing || 0,
  };
}

function withRates(c) {
  return {
    ...c,
    ownerRate: rate(c.owners, c.dials, 'ownerRate'),
    presentationRate: rate(c.presentations, c.owners, 'presentationRate'),
    appointmentRate: rate(c.appointments, c.presentations, 'appointmentRate'),
  };
}

// GET /api/metrics/funnel?from=&to=
router.get('/metrics/funnel', (req, res) => {
  const { from, to } = dateRange(req);
  const p = [from, to];
  const overall = withRates(funnelCounts('', p));

  // Weakest link: furthest below its target, measured on the CI's upper bound
  // so a rate that merely *might* be low doesn't outrank one that provably is.
  const candidates = ['ownerRate', 'presentationRate', 'appointmentRate']
    .map((k) => ({ key: k, ...overall[k], ...TARGETS[k] }))
    .filter((r) => r.total > 0);
  const failing = candidates.filter((r) => r.status === 'below');
  const pool = failing.length ? failing : candidates.filter((r) => r.value < r.target);
  const weakest = pool.sort((a, b) => (a.value - a.target) - (b.value - b.target))[0] || null;

  // Daily trend
  const daily = db.prepare(`
    SELECT date(n.created_at) day,
      COUNT(*) dials,
      SUM(CASE WHEN n.contact_role='owner' THEN 1 ELSE 0 END) owners,
      SUM(CASE WHEN n.presented=1 THEN 1 ELSE 0 END) presentations,
      SUM(CASE WHEN n.appointment_set=1 THEN 1 ELSE 0 END) appointments
    ${BASE} GROUP BY day ORDER BY day
  `).all(...p);

  // By state
  const byState = db.prepare(`
    SELECT CASE WHEN TRIM(COALESCE(l.state,''))='' THEN 'Unspecified' ELSE l.state END label,
      COUNT(*) dials,
      SUM(CASE WHEN n.contact_role='owner' THEN 1 ELSE 0 END) owners,
      SUM(CASE WHEN n.presented=1 THEN 1 ELSE 0 END) presentations,
      SUM(CASE WHEN n.appointment_set=1 THEN 1 ELSE 0 END) appointments
    ${BASE} GROUP BY label ORDER BY dials DESC
  `).all(...p).map((r) => ({ label: r.label, ...withRates(r) }));

  // By hour of day. created_at is UTC; the rep is IST and the prospects are US
  // Eastern, so the only hour that means anything operationally is ET — both
  // are labelled to avoid the timezone confusion that makes this unreadable.
  const byHour = db.prepare(`
    SELECT CAST(strftime('%H', n.created_at) AS INTEGER) utcHour,
      COUNT(*) dials,
      SUM(CASE WHEN n.contact_role='owner' THEN 1 ELSE 0 END) owners,
      SUM(CASE WHEN n.presented=1 THEN 1 ELSE 0 END) presentations,
      SUM(CASE WHEN n.appointment_set=1 THEN 1 ELSE 0 END) appointments
    ${BASE} GROUP BY utcHour ORDER BY utcHour
  `).all(...p).map((r) => {
    const et = (r.utcHour - 4 + 24) % 24;          // US Eastern (EDT, UTC-4)
    const istMin = (r.utcHour * 60 + 330) % 1440;  // IST = UTC+5:30
    const fmt = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
    return {
      label: fmt(et),
      etHour: et,
      istLabel: `${String(Math.floor(istMin / 60)).padStart(2, '0')}:${String(istMin % 60).padStart(2, '0')}`,
      ...withRates(r),
    };
  }).sort((a, b) => a.etHour - b.etHour);

  res.json({
    range: { from, to },
    overall,
    weakest: weakest ? { key: weakest.key, label: weakest.label, value: weakest.value, target: weakest.target, diagnosis: weakest.diagnosis, certain: weakest.status === 'below' } : null,
    daily,
    byState,
    byHour,
    minN: MIN_N,
    // How much of the range was actually tagged — a funnel built on 7% coverage
    // is not a measurement, and the UI needs to say so.
    coverage: { roleTagged: overall.dials - overall.roleMissing, dials: overall.dials, pct: pct(overall.dials - overall.roleMissing, overall.dials) },
  });
});

// GET /api/metrics/today - the daily target card.
const DAILY_GOALS = { dials: 200, owners: 20, presentations: 10, appointments: 2 };
router.get('/metrics/today', (req, res) => {
  const today = todayStr();
  const c = funnelCounts('', [today, today]);
  res.json({
    date: today,
    goals: DAILY_GOALS,
    counts: { dials: c.dials, owners: c.owners, presentations: c.presentations, appointments: c.appointments },
  });
});

export default router;
