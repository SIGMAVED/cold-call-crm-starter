import { Router } from 'express';
import { db } from '../db/init.js';
import { normalizePhone } from '../phone.js';

const router = Router();

function serializeCall(row) {
  if (!row) return row;
  const lead = row.lead_id
    ? db.prepare('SELECT id, business_name, contact_name FROM leads WHERE id = ?').get(row.lead_id)
    : null;
  return { ...row, lead };
}

// GET /api/calls?limit=20 - recent calls, newest first (extension "Recents" tab)
router.get('/calls', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const rows = db.prepare('SELECT * FROM calls ORDER BY started_at DESC LIMIT ?').all(limit);
  res.json(rows.map(serializeCall));
});

// GET /api/calls/today-count - calls placed today (local time), for the
// extension's daily-goal bar. Registered before /calls/:id so "today-count"
// isn't swallowed by the :id param.
router.get('/calls/today-count', (req, res) => {
  const row = db.prepare(
    `SELECT COUNT(*) c FROM calls WHERE date(started_at, 'localtime') = date('now', 'localtime')`
  ).get();
  res.json({ count: row.c });
});

// GET /api/calls/:id/recording - streams the call's MP3 straight from Twilio,
// authenticating server-side so the browser (and the <audio> tag) never sees
// the Twilio credentials. Range headers are passed through so seeking works.
// ?download=1 forces a file download instead of inline playback.
router.get('/calls/:id/recording', async (req, res) => {
  const row = db.prepare('SELECT sid, recording_url FROM calls WHERE id = ?').get(req.params.id);
  if (!row?.recording_url) return res.status(404).json({ error: 'no recording for this call' });

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return res.status(500).json({ error: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set' });
  }

  const headers = {
    Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
  };
  if (req.headers.range) headers.Range = req.headers.range;

  try {
    const upstream = await fetch(`${row.recording_url}.mp3`, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({ error: `recording fetch failed (${upstream.status})` });
    }
    res.status(upstream.status);
    res.setHeader('Content-Type', 'audio/mpeg');
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (req.query.download) {
      res.setHeader('Content-Disposition', `attachment; filename="call-${row.sid}.mp3"`);
    }
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/leads/:id/calls - a lead's call history, newest first, including
// any recording that's finished uploading.
router.get('/leads/:id/calls', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM calls WHERE lead_id = ? ORDER BY started_at DESC'
  ).all(req.params.id);
  res.json(rows);
});

// GET /api/calls/:id - a single call plus its transcript text, if any
router.get('/calls/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const transcript = db.prepare('SELECT text, created_at FROM transcripts WHERE call_id = ? ORDER BY id DESC LIMIT 1').get(row.id);
  res.json({ ...serializeCall(row), transcript: transcript?.text || null });
});

// GET /api/leads/by-phone/:phone - used by the voice webhook and the
// extension to show the lead's name while dialing/ringing.
router.get('/leads/by-phone/:phone', (req, res) => {
  const normalized = normalizePhone(req.params.phone);
  if (!normalized) return res.json(null);
  const row = db.prepare('SELECT * FROM leads WHERE phone_normalized = ?').get(normalized);
  res.json(row || null);
});

// POST /api/leads/check-dnc - body: { numbers: ["+1...", ...] }
// Returns the subset (normalized) that are do-not-call, checking both a
// lead's own `dnc` flag and the standalone dnc_numbers table (for numbers
// pasted into the dialer that aren't in the CRM at all).
router.post('/leads/check-dnc', (req, res) => {
  const numbers = Array.isArray(req.body?.numbers) ? req.body.numbers : [];
  const normalizedSet = new Set(numbers.map(normalizePhone).filter(Boolean));
  if (normalizedSet.size === 0) return res.json({ dnc: [] });

  const placeholders = [...normalizedSet].map(() => '?').join(',');
  const fromLeads = db.prepare(
    `SELECT phone_normalized FROM leads WHERE dnc = 1 AND phone_normalized IN (${placeholders})`
  ).all(...normalizedSet).map((r) => r.phone_normalized);
  const fromDnc = db.prepare(
    `SELECT phone_normalized FROM dnc_numbers WHERE phone_normalized IN (${placeholders})`
  ).all(...normalizedSet).map((r) => r.phone_normalized);

  res.json({ dnc: [...new Set([...fromLeads, ...fromDnc])] });
});

export default router;
