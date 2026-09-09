import { Router } from 'express';

const router = Router();

// Hand-off buffer between the CRM and the extension: "Send to dialer" in the
// CRM posts a batch here; the extension picks it up. Only the latest batch
// matters, and it's transient by nature, so in-memory is fine — a server
// restart just means re-sending the batch from the queue page.
let currentBatch = null;
let nextBatchId = 1;

// POST /api/dialer-queue { entries: [{ number, label }] }
router.post('/dialer-queue', (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const cleaned = entries
    .map((e) => ({ number: String(e.number || '').trim(), label: String(e.label || '').trim() }))
    .filter((e) => e.number);
  if (cleaned.length === 0) return res.status(400).json({ error: 'entries required' });
  currentBatch = { id: nextBatchId++, entries: cleaned, created_at: new Date().toISOString() };
  res.status(201).json(currentBatch);
});

// GET /api/dialer-queue - the latest batch, or null if none has been sent
router.get('/dialer-queue', (req, res) => {
  res.json(currentBatch);
});

export default router;
