import { Router } from 'express';
import { db } from '../db/init.js';

const router = Router();

// GET /api/inbox - voicemails and inbound SMS merged, newest first, with
// lead names attached where the number matches a lead.
router.get('/inbox', (req, res) => {
  const voicemails = db.prepare(`
    SELECT v.id, 'voicemail' AS type, v.from_number, v.duration_sec, v.transcript,
           v.created_at, l.business_name, l.contact_name
    FROM voicemails v LEFT JOIN leads l ON l.id = v.lead_id
    ORDER BY v.created_at DESC LIMIT 50
  `).all();
  const messages = db.prepare(`
    SELECT s.id, 'sms' AS type, s.from_number, s.body, s.created_at,
           l.business_name, l.contact_name
    FROM sms_messages s LEFT JOIN leads l ON l.id = s.lead_id
    WHERE s.direction = 'inbound'
    ORDER BY s.created_at DESC LIMIT 50
  `).all();
  const items = [...voicemails, ...messages]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 50);
  res.json(items);
});

// GET /api/inbox/voicemail/:id/audio - streams the recording. Twilio
// recording URLs need account auth, so the extension plays them through
// this proxy instead of hitting Twilio directly.
router.get('/inbox/voicemail/:id/audio', async (req, res) => {
  const vm = db.prepare('SELECT recording_url FROM voicemails WHERE id = ?').get(req.params.id);
  if (!vm?.recording_url) return res.status(404).json({ error: 'not found' });
  try {
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const upstream = await fetch(`${vm.recording_url}.mp3`, { headers: { Authorization: `Basic ${auth}` } });
    if (!upstream.ok) return res.status(502).json({ error: `recording fetch failed: ${upstream.status}` });
    res.type('audio/mpeg');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
