import { Router } from 'express';
import { db, TARGET_METRICS } from '../db/init.js';
import { HUMAN_INTERACTION_DISPOSITIONS, dialFilterSql } from './analytics.js';

const router = Router();

const UNIT_LABELS = { dials: 'dials', conversations: 'conversations', owner_conversations: 'owner conversations' };

// An empty end_date means the target has no deadline — a running total to hit
// "eventually" rather than by a date. Stored as '' rather than NULL so the
// existing NOT NULL column needs no migration.
const isOpenEnded = (row) => !row.end_date;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

// Monday of the calendar week containing `dateStr`.
function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  date.setUTCDate(date.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return date.toISOString().slice(0, 10);
}

// A recurring target's stored start/end is just the template for how many
// days it spans (e.g. Mon-Fri = 5 days) — the actual window is always
// "this calendar week," recomputed from today rather than a stored date, so
// it never needs a new row created each week and can't go stale if the app
// was closed for a few days.
function resolveWindow(row) {
  if (isOpenEnded(row)) return { start_date: row.start_date, end_date: '' };
  if (row.recurring !== 'weekly') return { start_date: row.start_date, end_date: row.end_date };
  const spanDays = daysBetween(row.end_date, row.start_date);
  const thisMonday = mondayOf(todayStr());
  return { start_date: thisMonday, end_date: addDays(thisMonday, spanDays) };
}

// Progress count for a target's metric, scoped to [start, through]. "dials"
// counts every dial; "conversations" counts only the dispositions that
// imply an actual live person responded (same definition Connect Rate uses).
function countProgress(metric, start, through, campaign) {
  const campClause = campaign ? " AND l.campaign = ?" : "";
  const campParam = campaign ? [campaign] : [];

  if (metric === 'conversations') {
    const placeholders = HUMAN_INTERACTION_DISPOSITIONS.map(() => '?').join(',');
    return db.prepare(
      `SELECT COUNT(*) c FROM notes n JOIN leads l ON n.lead_id = l.id WHERE n.outcome IN (${placeholders}) AND date(n.created_at) BETWEEN ? AND ?${campClause}`
    ).get(...HUMAN_INTERACTION_DISPOSITIONS, start, through, ...campParam).c;
  }
  if (metric === 'owner_conversations') {
    // `role` lives on the lead as current state, not per call — a lead whose
    // role is now Owner may also have earlier gatekeeper calls logged against
    // it. Counting DISTINCT leads is therefore the only honest reading of
    // "owner conversations"; counting notes would inflate it with the calls
    // that never actually reached the owner.
    return db.prepare(
      `SELECT COUNT(DISTINCT l.id) c FROM leads l
       JOIN notes n ON n.lead_id = l.id AND ${dialFilterSql('n')}
       WHERE l.role = 'Owner' AND date(n.created_at) BETWEEN ? AND ?${campClause}`
    ).get(start, through, ...campParam).c;
  }
  return db.prepare(
    `SELECT COUNT(*) c FROM notes n JOIN leads l ON n.lead_id = l.id WHERE ${dialFilterSql('n')} AND date(n.created_at) BETWEEN ? AND ?${campClause}`
  ).get(start, through, ...campParam).c;
}

function withProgress(row) {
  if (!row) return row;
  const today = todayStr();
  const { start_date, end_date } = resolveWindow(row);
  const openEnded = !end_date;

  // With no deadline there is nothing to be "behind" against, so pace, days
  // left and per-day-needed are reported as null rather than invented from a
  // sentinel date — the UI hides them instead of showing a nonsense figure.
  const countThrough = today < start_date ? null : (openEnded || today <= end_date ? today : end_date);
  const progressCount = countThrough ? countProgress(row.metric, start_date, countThrough, row.campaign) : 0;

  let phase = 'active';
  if (today < start_date) phase = 'upcoming';
  else if (!openEnded && today > end_date) phase = 'ended';

  let totalDays = null;
  let daysLeft = null;
  let perDayNeeded = null;
  let paceStatus = 'on_pace';

  if (!openEnded) {
    totalDays = daysBetween(end_date, start_date) + 1;
    daysLeft = daysBetween(end_date, today);
    const daysElapsed = countThrough ? Math.max(0, daysBetween(countThrough, start_date) + 1) : 0;
    const expectedByNow = (row.target_count * daysElapsed) / totalDays;
    const remaining = Math.max(0, row.target_count - progressCount);
    perDayNeeded = daysLeft > 0 ? Math.round((remaining / daysLeft) * 10) / 10 : null;
    if (phase === 'active') {
      if (expectedByNow > 0 && progressCount < expectedByNow * 0.85) paceStatus = 'behind';
      else if (expectedByNow > 0 && progressCount < expectedByNow) paceStatus = 'at_risk';
    }
  }

  return {
    ...row,
    start_date,
    end_date,
    openEnded,
    unit: UNIT_LABELS[row.metric] || row.metric,
    progressCount,
    percent: Math.round((progressCount / row.target_count) * 1000) / 10,
    daysLeft,
    totalDays,
    perDayNeeded,
    phase,
    paceStatus,
  };
}

// GET /api/targets - all targets, newest first
router.get('/targets', (req, res) => {
  const rows = db.prepare('SELECT * FROM targets ORDER BY start_date DESC').all();
  res.json(rows.map(withProgress));
});

// GET /api/targets/current - a recurring target is always "current" (its
// window is virtual, recomputed from today), so it takes priority over a
// one-off target whose literal date range covers today; falls back to the
// most recently created target if neither applies.
router.get('/targets/current', (req, res) => {
  const today = todayStr();
  let row = db.prepare(`SELECT * FROM targets WHERE recurring IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get();
  if (!row) {
    row = db.prepare(
      `SELECT * FROM targets WHERE start_date <= ? AND end_date >= ? ORDER BY created_at DESC LIMIT 1`
    ).get(today, today);
  }
  if (!row) row = db.prepare('SELECT * FROM targets ORDER BY created_at DESC LIMIT 1').get();
  if (!row) return res.json(null);
  res.json(withProgress(row));
});

// GET /api/targets/active - every target currently in play, so running more
// than one goal (e.g. a weekly dial count AND an open-ended owner-conversation
// count) doesn't silently hide all but one behind /targets/current.
router.get('/targets/active', (req, res) => {
  const today = todayStr();
  const rows = db.prepare('SELECT * FROM targets ORDER BY created_at DESC').all()
    .map(withProgress)
    .filter((t) => t.phase !== 'ended');
  res.json(rows);
});

// POST /api/targets - create { label, metric, target_count, start_date, end_date, recurring }
// `recurring: 'weekly'` re-anchors start_date/end_date to the current week on
// every read (see resolveWindow) — the stored dates just set the span (e.g.
// Mon-Fri = 5 days) for the first week.
router.post('/targets', (req, res) => {
  const { label, metric, target_count, start_date, end_date, recurring, campaign } = req.body || {};
  const resolvedMetric = TARGET_METRICS.includes(metric) ? metric : 'dials';
  const resolvedRecurring = recurring === 'weekly' ? 'weekly' : null;
  // end_date is optional: omitting it creates an open-ended target (a running
  // total with no deadline). A recurring target still needs one, since its
  // span is what defines the repeating window.
  if (!label?.trim() || !target_count || !start_date) {
    return res.status(400).json({ error: 'label, target_count and start_date are required' });
  }
  if (resolvedRecurring && !end_date) {
    return res.status(400).json({ error: 'a recurring target needs an end_date to define its weekly span' });
  }
  const info = db.prepare(
    'INSERT INTO targets (label, metric, target_count, start_date, end_date, recurring, campaign) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(label.trim(), resolvedMetric, parseInt(target_count, 10), start_date, end_date || '', resolvedRecurring, campaign || null);
  const row = db.prepare('SELECT * FROM targets WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(withProgress(row));
});

// PATCH /api/targets/:id - update any of { label, metric, target_count, start_date, end_date, recurring }
router.patch('/targets/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM targets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const updates = {};
  if (req.body.label !== undefined) updates.label = String(req.body.label).trim();
  if (req.body.metric !== undefined && TARGET_METRICS.includes(req.body.metric)) updates.metric = req.body.metric;
  if (req.body.target_count !== undefined) updates.target_count = parseInt(req.body.target_count, 10);
  if (req.body.start_date !== undefined) updates.start_date = req.body.start_date;
  if (req.body.end_date !== undefined) updates.end_date = req.body.end_date;
  if (req.body.recurring !== undefined) updates.recurring = req.body.recurring === 'weekly' ? 'weekly' : null;
  if (req.body.campaign !== undefined) updates.campaign = req.body.campaign || null;

  const keys = Object.keys(updates);
  if (keys.length === 0) return res.json(withProgress(existing));

  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE targets SET ${setClause} WHERE id = @id`).run({ ...updates, id: req.params.id });
  const row = db.prepare('SELECT * FROM targets WHERE id = ?').get(req.params.id);
  res.json(withProgress(row));
});

router.delete('/targets/:id', (req, res) => {
  db.prepare('DELETE FROM targets WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export default router;
