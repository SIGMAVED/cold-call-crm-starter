import { Router } from 'express';
import { db } from '../db/init.js';
import { dialFilterSql } from './analytics.js';

const router = Router();

// ----------------------------------------------------------------
// IG challenge config. Lives here (not in the targets table) on
// purpose: this is public-facing content data, computed from its own
// dedicated endpoint so it never shares a code path with the private
// CRM/sprint targets shown internally. See CLAUDE.md: public/private
// data boundary is a hard architectural rule, not just a UI filter.
//
// Dials: 200/day, weekdays only, starting Jul 9.
// Proposals: flat 100 total (not per-day) by the Aug 15 deadline,
// starting Jul 10 — paced linearly against weekdays elapsed.
// ----------------------------------------------------------------
const CHALLENGE_END = '2026-08-15';
const DIALS_START = '2026-07-09';
const DIALS_PER_DAY = 200;
const PROPOSALS_START = '2026-07-10';
const PROPOSALS_TOTAL_TARGET = 100;
const CLIENT_STATUS_KEY = 'public_client_status';
const DEFAULT_CLIENT_STATUS = 'Still hunting';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Inclusive count of Mon-Fri dates in [start, end]. Returns 0 if end < start.
function weekdaysBetween(start, end) {
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  while (cursor <= endDate) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function countDials(start, end) {
  return db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE ${dialFilterSql()} AND date(created_at) BETWEEN ? AND ?`
  ).get(start, end).c;
}

function countProposals(start, end) {
  return db.prepare(
    `SELECT COALESCE(SUM(count), 0) c FROM upwork_proposals WHERE date BETWEEN ? AND ?`
  ).get(start, end).c;
}

function paceStatus(total, expectedByNow) {
  if (expectedByNow <= 0) return 'on_pace';
  if (total < expectedByNow * 0.85) return 'behind';
  if (total < expectedByNow) return 'at_risk';
  return 'on_pace';
}

function getClientStatus() {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(CLIENT_STATUS_KEY);
  return row ? row.value : DEFAULT_CLIENT_STATUS;
}

// Shared phase/day-count scaffolding for a metric with its own start date
// against the common CHALLENGE_END deadline. `target` and `expectedByNow`
// are supplied by the caller since dials (per-day rate) and proposals
// (flat total, prorated) use different math.
function buildMetricProgress(start, countFn, computeTarget) {
  const today = todayStr();

  let phase = 'active';
  if (today < start) phase = 'upcoming';
  else if (today > CHALLENGE_END) phase = 'ended';

  const through = phase === 'upcoming' ? null : (phase === 'ended' ? CHALLENGE_END : today);

  const weekdaysTotal = weekdaysBetween(start, CHALLENGE_END);
  const weekdaysElapsed = through ? weekdaysBetween(start, through) : 0;
  const daysLeft = Math.max(0, weekdaysTotal - weekdaysElapsed);
  const total = through ? countFn(start, through) : 0;
  const { target, expectedByNow } = computeTarget(weekdaysTotal, weekdaysElapsed);

  return {
    phase,
    startDate: start,
    dayCount: weekdaysElapsed,
    totalDays: weekdaysTotal,
    daysLeft,
    total,
    target,
    expectedByNow: Math.round(expectedByNow),
    pace: paceStatus(total, expectedByNow),
  };
}

// GET /api/public/challenge - everything the public tracker needs, in one call
router.get('/challenge', (req, res) => {
  const dials = {
    ...buildMetricProgress(DIALS_START, countDials, (weekdaysTotal, weekdaysElapsed) => ({
      target: weekdaysTotal * DIALS_PER_DAY,
      expectedByNow: weekdaysElapsed * DIALS_PER_DAY,
    })),
    perDay: DIALS_PER_DAY,
  };

  const proposals = {
    ...buildMetricProgress(PROPOSALS_START, countProposals, (weekdaysTotal, weekdaysElapsed) => ({
      target: PROPOSALS_TOTAL_TARGET,
      expectedByNow: weekdaysTotal > 0 ? (PROPOSALS_TOTAL_TARGET * weekdaysElapsed) / weekdaysTotal : 0,
    })),
  };

  const today = todayStr();
  const daysToDeadline = Math.max(0, Math.round(
    (new Date(`${CHALLENGE_END}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000
  ));

  res.json({
    today,
    challengeEnd: CHALLENGE_END,
    daysToDeadline,
    dials,
    proposals,
    clientStatus: getClientStatus(),
  });
});

// POST /api/public/upwork - upsert { date: 'YYYY-MM-DD', count: number }
router.post('/upwork', (req, res) => {
  const { date, count } = req.body || {};
  if (!date || Number.isNaN(parseInt(count, 10))) {
    return res.status(400).json({ error: 'date and count are required' });
  }
  db.prepare(`
    INSERT INTO upwork_proposals (date, count, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(date) DO UPDATE SET count = excluded.count, updated_at = datetime('now')
  `).run(date, parseInt(count, 10));
  res.status(204).end();
});

// POST /api/public/client-status - { status: string }
router.post('/client-status', (req, res) => {
  const { status } = req.body || {};
  if (!status?.trim()) return res.status(400).json({ error: 'status is required' });
  db.prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(CLIENT_STATUS_KEY, status.trim());
  res.json({ status: status.trim() });
});

export default router;
