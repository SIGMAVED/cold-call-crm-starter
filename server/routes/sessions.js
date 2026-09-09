import { Router } from 'express';
import { db } from '../db/init.js';

const router = Router();

// Dials/hour needs a non-trivial duration to mean anything; sessions
// shorter than this are reported with dialsPerHour = null rather than an
// inflated/misleading rate.
const MIN_DURATION_HOURS_FOR_RATE = 1 / 60;

function toUtcMs(sqliteTimestamp) {
  return new Date(`${sqliteTimestamp.replace(' ', 'T')}Z`).getTime();
}

function serializeSession(row) {
  if (!row) return row;
  const startedMs = toUtcMs(row.started_at);
  const endedMs = row.ended_at ? toUtcMs(row.ended_at) : Date.now();
  const durationMinutes = Math.max(0, (endedMs - startedMs) / 60000);
  const durationHours = durationMinutes / 60;
  const dialsPerHour = durationHours >= MIN_DURATION_HOURS_FOR_RATE
    ? Math.round((row.dial_count / durationHours) * 10) / 10
    : null;
  return { ...row, durationMinutes: Math.round(durationMinutes), dialsPerHour };
}

// GET /api/sessions - most recent calling sessions, newest first, optionally
// scoped to ?from=YYYY-MM-DD&to=YYYY-MM-DD to match the Analytics date range.
router.get('/sessions', (req, res) => {
  const { from, to } = req.query;
  const hasRange = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
  const rows = hasRange
    ? db.prepare('SELECT * FROM sessions WHERE date(started_at) BETWEEN ? AND ? ORDER BY started_at DESC LIMIT 50').all(from, to)
    : db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 50').all();
  res.json(rows.map(serializeSession));
});

// POST /api/sessions - called when an Active Session starts
router.post('/sessions', (req, res) => {
  const leadCount = parseInt(req.body?.lead_count, 10) || 0;
  const info = db.prepare('INSERT INTO sessions (lead_count) VALUES (?)').run(leadCount);
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serializeSession(row));
});

// PATCH /api/sessions/:id - called after each dial and on leaving the page,
// keeping ended_at fresh and dial_count accurate even if the tab is closed
// mid-session.
router.patch('/sessions/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const dialCount = req.body?.dial_count !== undefined ? parseInt(req.body.dial_count, 10) : existing.dial_count;
  db.prepare(`UPDATE sessions SET ended_at = datetime('now'), dial_count = ? WHERE id = ?`).run(dialCount, req.params.id);
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  res.json(serializeSession(row));
});

export default router;
