import { Router } from 'express';
import { db } from '../db/init.js';

const router = Router();

function slugify(label) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
}

function nextSortOrder(table) {
  return db.prepare(`SELECT COALESCE(MAX(sort_order), -1) m FROM ${table}`).get().m + 1;
}

// ---- Statuses ----

router.get('/statuses', (req, res) => {
  res.json(db.prepare('SELECT * FROM statuses ORDER BY sort_order, id').all());
});

router.post('/statuses', (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const info = db.prepare('INSERT INTO statuses (name, color, sort_order) VALUES (?, ?, ?)')
      .run(name, req.body.color || 'badge-neutral', nextSortOrder('statuses'));
    res.status(201).json(db.prepare('SELECT * FROM statuses WHERE id = ?').get(info.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'a status with that name already exists' });
  }
});

router.patch('/statuses/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const name = req.body.name !== undefined ? req.body.name.trim() : existing.name;
  const color = req.body.color !== undefined ? req.body.color : existing.color;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const tx = db.transaction(() => {
      if (name !== existing.name) {
        db.prepare('UPDATE leads SET status = ? WHERE status = ?').run(name, existing.name);
        db.prepare('UPDATE outcomes SET status = ? WHERE status = ?').run(name, existing.name);
      }
      db.prepare('UPDATE statuses SET name = ?, color = ? WHERE id = ?').run(name, color, req.params.id);
    });
    tx();
    res.json(db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.id));
  } catch {
    res.status(409).json({ error: 'a status with that name already exists' });
  }
});

router.delete('/statuses/:id', (req, res) => {
  db.prepare('DELETE FROM statuses WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---- Outcomes ----

router.get('/outcomes', (req, res) => {
  res.json(db.prepare('SELECT * FROM outcomes ORDER BY sort_order, id').all());
});

router.post('/outcomes', (req, res) => {
  const label = (req.body?.label || '').trim();
  const status = (req.body?.status || '').trim();
  const key = (req.body?.key || '').trim();
  if (!label || !status || !key) return res.status(400).json({ error: 'label, status, and key are required' });
  try {
    const info = db.prepare(`
      INSERT INTO outcomes (label, status, key, is_connect, needs_followup, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(label, status, key, req.body.is_connect ? 1 : 0, req.body.needs_followup ? 1 : 0, nextSortOrder('outcomes'));
    res.status(201).json(db.prepare('SELECT * FROM outcomes WHERE id = ?').get(info.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'an outcome with that label or shortcut key already exists' });
  }
});

router.patch('/outcomes/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM outcomes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const updated = {
    label: req.body.label !== undefined ? req.body.label.trim() : existing.label,
    status: req.body.status !== undefined ? req.body.status.trim() : existing.status,
    key: req.body.key !== undefined ? req.body.key.trim() : existing.key,
    is_connect: req.body.is_connect !== undefined ? (req.body.is_connect ? 1 : 0) : existing.is_connect,
    needs_followup: req.body.needs_followup !== undefined ? (req.body.needs_followup ? 1 : 0) : existing.needs_followup,
  };
  if (!updated.label || !updated.status || !updated.key) return res.status(400).json({ error: 'label, status, and key are required' });
  try {
    db.prepare(`
      UPDATE outcomes SET label = ?, status = ?, key = ?, is_connect = ?, needs_followup = ? WHERE id = ?
    `).run(updated.label, updated.status, updated.key, updated.is_connect, updated.needs_followup, req.params.id);
    res.json(db.prepare('SELECT * FROM outcomes WHERE id = ?').get(req.params.id));
  } catch {
    res.status(409).json({ error: 'an outcome with that label or shortcut key already exists' });
  }
});

router.delete('/outcomes/:id', (req, res) => {
  db.prepare('DELETE FROM outcomes WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---- Custom fields (simple text fields stored as JSON on each lead) ----

router.get('/custom-fields', (req, res) => {
  res.json(db.prepare('SELECT * FROM custom_fields ORDER BY sort_order, id').all());
});

router.post('/custom-fields', (req, res) => {
  const label = (req.body?.label || '').trim();
  if (!label) return res.status(400).json({ error: 'label required' });
  let key = slugify(label);
  let suffix = 1;
  while (db.prepare('SELECT id FROM custom_fields WHERE key = ?').get(key)) {
    suffix += 1;
    key = `${slugify(label)}_${suffix}`;
  }
  const info = db.prepare('INSERT INTO custom_fields (key, label, sort_order) VALUES (?, ?, ?)')
    .run(key, label, nextSortOrder('custom_fields'));
  res.status(201).json(db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/custom-fields/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const label = (req.body?.label || '').trim();
  if (!label) return res.status(400).json({ error: 'label required' });
  db.prepare('UPDATE custom_fields SET label = ? WHERE id = ?').run(label, req.params.id);
  res.json(db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(req.params.id));
});

router.delete('/custom-fields/:id', (req, res) => {
  db.prepare('DELETE FROM custom_fields WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export default router;
