import { Router } from 'express';
import { db } from '../db/init.js';
import { reviewBandSql, reviewBandOrderSql } from '../reviewBands.js';

const router = Router();

// Dispositions that count as a "Human Interaction" for Connect Rate — the
// three that imply an actual live person responded (voicemail, a busy
// signal, and bad data all mean nobody was reached). Exported so the
// targets route can reuse the same definition for a "conversations" target.
export const HUMAN_INTERACTION_DISPOSITIONS = ['Rejected', 'Follow up scheduled', 'Meeting Booked'];
const VOICEMAIL_DISPOSITIONS = ['Ring to Voicemail', 'Direct Voicemail'];

// "Email Sent" is a real `outcome` value (so it can log to the activity feed
// and flip lead status the same way a call disposition does) but it isn't a
// phone dial — every "dial" count in the app is literally `outcome IS NOT
// NULL`, so without this exclusion, sending a follow-up email silently
// inflates dial totals, the weekly dial target, and every connect/demo-rate
// denominator that divides by dial count. Exported so every other route that
// counts dials uses the same definition instead of drifting.
export function dialFilterSql(alias) {
  const col = alias ? `${alias}.outcome` : 'outcome';
  return `${col} IS NOT NULL AND ${col} != 'Email Sent'`;
}
const REJECTED_STATUS = 'Rejected';
const QUALIFIED_STATUS = 'Meeting Booked';

const BAD_DATA_OUTCOME = 'Bad Data / Wrong Number';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function pct(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

// Every analytics endpoint takes the same ?from=YYYY-MM-DD&to=YYYY-MM-DD
// window (a la Meta Ads Manager's date-range picker). Missing/invalid bounds
// fall back to "all time" so old callers (e.g. Session.jsx's todayDials read)
// keep working unfiltered.
function dateRange(req) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : '1970-01-01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : todayStr();
  return { from, to };
}

// GET /api/analytics - the cold-calling analytics dashboard's metrics.
// "Dials" are per-attempt call logs: rows in `notes` with outcome set
// (every log-call writes one), as distinct from freeform manual notes.
// All metrics below are scoped to the requested date range by when the dial
// was logged, so re-running a disposition (e.g. Bad Data) outside the window
// doesn't bleed into it — a lead's *current* status would, since status is a
// single mutable field with no history.
router.get('/analytics', (req, res) => {
  const { from, to } = dateRange(req);
  const today = todayStr();

  const totalDials = db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE ${dialFilterSql()} AND date(created_at) BETWEEN ? AND ?`
  ).get(from, to).c;
  const todayDials = db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE ${dialFilterSql()} AND date(created_at) = ?`
  ).get(today).c;

  const humanPlaceholders = HUMAN_INTERACTION_DISPOSITIONS.map(() => '?').join(',');
  const humanInteractions = db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE outcome IN (${humanPlaceholders}) AND date(created_at) BETWEEN ? AND ?`
  ).get(...HUMAN_INTERACTION_DISPOSITIONS, from, to).c;
  const connectRate = pct(humanInteractions, totalDials);

  const leadsDialed = db.prepare(
    `SELECT COUNT(DISTINCT lead_id) c FROM notes WHERE ${dialFilterSql()} AND date(created_at) BETWEEN ? AND ?`
  ).get(from, to).c;
  const rejectedDials = db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE outcome = ? AND date(created_at) BETWEEN ? AND ?`
  ).get(REJECTED_STATUS, from, to).c;
  const rejectionRate = pct(rejectedDials, leadsDialed);

  const junkDataCount = db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE outcome = ? AND date(created_at) BETWEEN ? AND ?`
  ).get(BAD_DATA_OUTCOME, from, to).c;

  const qualifiedDials = db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE outcome = ? AND date(created_at) BETWEEN ? AND ?`
  ).get(QUALIFIED_STATUS, from, to).c;
  const demoRate = pct(qualifiedDials, humanInteractions);

  const voicemailPlaceholders = VOICEMAIL_DISPOSITIONS.map(() => '?').join(',');
  const voicemailDials = db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE outcome IN (${voicemailPlaceholders}) AND date(created_at) BETWEEN ? AND ?`
  ).get(...VOICEMAIL_DISPOSITIONS, from, to).c;
  const voicemailRate = pct(voicemailDials, totalDials);

  res.json({
    totalDials,
    todayDials,
    connectRate,
    rejectionRate,
    junkDataCount,
    demoRate,
    voicemailRate,
    humanInteractions,
    leadsDialed,
  });
});

// GET /api/analytics/daily-dials - dial counts per calendar day across the
// requested range, zero-filled so gaps show as empty days rather than
// skipping them.
router.get('/analytics/daily-dials', (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db.prepare(
    `SELECT date(created_at) day, COUNT(*) c FROM notes
     WHERE ${dialFilterSql()} AND date(created_at) BETWEEN ? AND ?
     GROUP BY day`
  ).all(from, to);
  const byDay = new Map(rows.map((r) => [r.day, r.c]));

  const series = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    series.push({ date: key, count: byDay.get(key) || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  res.json(series);
});

// GET /api/analytics/dispositions - dial counts grouped by disposition
// within the range, highest first (includes any legacy outcome labels still
// on old dials).
router.get('/analytics/dispositions', (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db.prepare(
    `SELECT outcome label, COUNT(*) count FROM notes
     WHERE ${dialFilterSql()} AND date(created_at) BETWEEN ? AND ?
     GROUP BY outcome ORDER BY count DESC`
  ).all(from, to);
  res.json(rows);
});

// GET /api/analytics/roles - among leads dialed at least once in the range,
// how many were reached at each role. Role is a current-state field on the
// lead (no history), so this is "current role of leads touched in-range" —
// dialed-but-no-role-recorded lands in "Unknown" rather than disappearing.
const ROLE_LABELS = ['Owner', 'Gatekeeper', 'AI'];
router.get('/analytics/roles', (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db.prepare(
    `SELECT l.role role, COUNT(DISTINCT l.id) c FROM leads l
     JOIN notes n ON n.lead_id = l.id AND ${dialFilterSql('n')}
     WHERE date(n.created_at) BETWEEN ? AND ?
     GROUP BY l.role`
  ).all(from, to);
  const byRole = new Map(rows.map((r) => [r.role, r.c]));
  const known = ROLE_LABELS.reduce((sum, r) => sum + (byRole.get(r) || 0), 0);
  const total = db.prepare(
    `SELECT COUNT(DISTINCT lead_id) c FROM notes WHERE ${dialFilterSql()} AND date(created_at) BETWEEN ? AND ?`
  ).get(from, to).c;

  const result = ROLE_LABELS.map((label) => ({ label, count: byRole.get(label) || 0 }));
  result.push({ label: 'Unknown', count: total - known });
  res.json(result);
});

// GET /api/analytics/segments?by=state|niche - the full funnel broken out per
// state or per vertical. Working several states/niches at once makes the
// blended connect/demo rate misleading: one strong segment can hide a dead
// one. This is the view that says which list is worth more dials.
// `by` is whitelisted to a column name — never interpolated from raw input.
const SEGMENT_COLUMNS = { state: 'state', niche: 'niche', city: 'city', source: 'source' };
router.get('/analytics/segments', (req, res) => {
  const { from, to } = dateRange(req);
  const humanPlaceholders = HUMAN_INTERACTION_DISPOSITIONS.map(() => '?').join(',');

  // `by=reviews` groups by business size band instead of a plain column, so
  // the label and ordering come from a CASE rather than the column itself.
  const byReviews = req.query.by === 'reviews';
  const col = SEGMENT_COLUMNS[req.query.by] || 'state';
  const labelSql = byReviews
    ? reviewBandSql('l.review_count')
    : `CASE WHEN TRIM(COALESCE(l.${col}, '')) = '' THEN 'Unspecified' ELSE l.${col} END`;
  // Size bands read best smallest-to-largest; everything else by volume.
  const orderSql = byReviews ? `MIN(${reviewBandOrderSql('l.review_count')}) ASC` : 'dials DESC';

  const rows = db.prepare(`
    SELECT
      ${labelSql} AS label,
      COUNT(*) AS dials,
      COUNT(DISTINCT l.id) AS leads,
      SUM(CASE WHEN n.outcome IN (${humanPlaceholders}) THEN 1 ELSE 0 END) AS conversations,
      SUM(CASE WHEN n.outcome = ? THEN 1 ELSE 0 END) AS meetings
    FROM notes n
    JOIN leads l ON l.id = n.lead_id
    WHERE ${dialFilterSql('n')} AND date(n.created_at) BETWEEN ? AND ?
    GROUP BY label
    ORDER BY ${orderSql}
  `).all(...HUMAN_INTERACTION_DISPOSITIONS, QUALIFIED_STATUS, from, to);

  res.json(rows.map((r) => ({
    ...r,
    connectRate: pct(r.conversations, r.dials),
    demoRate: pct(r.meetings, r.conversations),
  })));
});

export default router;
