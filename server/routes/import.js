import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import crypto from 'node:crypto';
import { db } from '../db/init.js';
import { normalizePhone } from '../phone.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Pending parsed uploads, kept in memory only for the current server run.
const pending = new Map();

const LEAD_FIELDS = [
  { key: 'business_name', label: 'Business Name' },
  { key: 'contact_name', label: 'Contact Name' },
  { key: 'owner_name', label: 'Owner Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'phone_2', label: 'Phone 2' },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Website' },
  { key: 'google_maps_url', label: 'Google Maps URL' },
  { key: 'working_hours', label: 'Working Hours' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'niche', label: 'Niche / Industry' },
  { key: 'source', label: 'Source' },
  { key: 'review_count', label: 'Review Count' },
  { key: 'rating', label: 'Rating (stars)' },
  { key: 'lead_score', label: 'Lead Score' },
  { key: 'missed_call_evidence', label: 'Missed-Call Evidence (review quote)' },
  { key: 'place_id', label: 'Google Place ID or Maps Link' },
  { key: 'priority_tier', label: 'Priority Tier (sets Hot/Warm/Cold)' },
  { key: 'notes', label: 'Notes (goes into activity log)' },
  { key: 'campaign', label: 'Campaign' },
];

// Best-effort auto-mapping so the user usually just has to confirm.
const AUTO_MATCH = {
  business_name: ['business name', 'business', 'company', 'company name', 'name'],
  contact_name: ['contact name', 'contact'],
  owner_name: ['owner name', 'owner', 'possible owner name', 'possible owner'],
  phone: ['phone', 'phone number', 'primary phone', 'mobile'],
  phone_2: ['phone 2', 'secondary phone', 'alt phone', 'phone2'],
  email: ['email', 'email address'],
  website: ['website', 'web', 'site', 'url', 'web address'],
  google_maps_url: ['google maps url', 'maps url', 'google maps link', 'google url', 'place url', 'link', 'google maps'],
  working_hours: ['working hours', 'hours', 'business hours', 'opening hours', 'open hours'],
  address: ['address', 'street address'],
  city: ['city'],
  state: ['state', 'province', 'region'],
  niche: ['niche', 'industry', 'category', 'vertical', 'business type', 'type', 'trade'],
  source: ['source', 'lead source'],
  review_count: ['review count', 'reviews', 'reviews count', 'number of reviews', 'total reviews'],
  rating: ['rating', 'stars', 'star rating', 'avg rating', 'average rating'],
  lead_score: ['score', 'lead score', 'lead_score'],
  missed_call_evidence: ['evidence', 'missed call evidence', 'review evidence', 'proof'],
  place_id: ['place id', 'place_id', 'google place id', 'placeid'],
  priority_tier: ['priority tier', 'priority_tier', 'tier'],
  notes: ['notes', 'note'],
  campaign: ['campaign'],
};

// Scraped lists routinely carry the state only inside the full address
// ("4979 Old Hwy 5, Canton, GA 30115, USA") with no state column of its own.
// Pulling it out here is what makes per-state filtering and the analytics
// state breakdown work on those files instead of dumping everything into
// "Unspecified".
const STATE_IN_ADDRESS_RE = /,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?(?:\s*,\s*USA)?\s*$/;
function stateFromAddress(address) {
  const match = String(address || '').trim().match(STATE_IN_ADDRESS_RE);
  return match ? match[1] : '';
}

// Tiered lists ("1 - CALL FIRST", "3 - standard", "4 - QUEUED") map onto the
// CRM's Hot/Warm/Cold so the queue's priority filter is immediately useful.
function priorityFromTier(tier) {
  const value = String(tier || '').trim();
  if (/^[12]\b/.test(value)) return 'Hot';
  if (/^3\b/.test(value)) return 'Warm';
  if (/^4\b/.test(value)) return 'Cold';
  return '';
}

// Scrapes often store these lowercase ("atlanta", "water damage restoration").
// Title-casing keeps filter dropdowns from listing "atlanta" and "Atlanta" as
// two different places.
//
// Acronyms must survive intact: naive title-casing turns "HVAC" into "Hvac",
// which silently forks an existing niche into two values and splits every
// per-niche report. A word that's already all-caps is left alone.
function titleCase(value) {
  return String(value || '')
    .trim()
    .replace(/\S+/g, (word) => (
      /^[A-Z0-9][A-Z0-9&/.-]*$/.test(word) && /[A-Z]/.test(word)
        ? word
        : word[0].toUpperCase() + word.slice(1).toLowerCase()
    ));
}

// Different exports name the same column differently — "google_maps_link" vs
// "Google Maps Link" vs "google maps link". Normalise separators to spaces so
// the auto-match candidates (written with spaces) hit regardless of style.
function normHeader(h) {
  return String(h).toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function guessMapping(headers) {
  const mapping = {};
  const lowerHeaders = headers.map(normHeader);
  for (const field of LEAD_FIELDS) {
    const candidates = (AUTO_MATCH[field.key] || []).map(normHeader);
    const idx = lowerHeaders.findIndex((h) => candidates.includes(h));
    if (idx !== -1) mapping[field.key] = headers[idx];
  }
  return mapping;
}

// POST /api/import/preview
router.post('/preview', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (e) {
    return res.status(400).json({ error: `could not parse CSV: ${e.message}` });
  }
  if (records.length === 0) return res.status(400).json({ error: 'CSV has no rows' });

  const headers = Object.keys(records[0]);
  const importId = crypto.randomUUID();
  pending.set(importId, records);
  // Best-effort cleanup so long-running dev sessions don't leak memory.
  setTimeout(() => pending.delete(importId), 30 * 60 * 1000).unref();

  res.json({
    importId,
    headers,
    fields: LEAD_FIELDS,
    suggestedMapping: guessMapping(headers),
    rowCount: records.length,
    sampleRows: records.slice(0, 5),
  });
});

// POST /api/import/commit
router.post('/commit', (req, res) => {
  const { importId, mapping, defaults = {} } = req.body;
  const records = pending.get(importId);
  if (!records) return res.status(400).json({ error: 'import session expired, re-upload the CSV' });
  if (!mapping || !mapping.phone) return res.status(400).json({ error: 'phone column mapping is required' });

  const existingPhones = new Set(
    db.prepare(`SELECT phone_normalized FROM leads WHERE phone_normalized != ''`).all().map((r) => r.phone_normalized)
  );

  const insert = db.prepare(`
    INSERT INTO leads (business_name, contact_name, owner_name, phone, phone_normalized, phone_2, email, website, google_maps_url, working_hours, address, city, state, niche, source, status, priority, next_followup_date, review_count, rating, lead_score, missed_call_evidence, campaign)
    VALUES (@business_name, @contact_name, @owner_name, @phone, @phone_normalized, @phone_2, @email, @website, @google_maps_url, @working_hours, @address, @city, @state, @niche, @source, 'New', @priority, NULL, @review_count, @rating, @lead_score, @missed_call_evidence, @campaign)
  `);
  const insertNote = db.prepare(`INSERT INTO notes (lead_id, body) VALUES (?, ?)`);

  let imported = 0;
  let duplicates = 0;
  let skippedNoPhone = 0;

  const tx = db.transaction(() => {
    for (const record of records) {
      const get = (fieldKey) => {
        const col = mapping[fieldKey];
        return col ? (record[col] ?? '').toString().trim() : '';
      };
      const phone = get('phone');
      const phone_normalized = normalizePhone(phone);
      if (!phone_normalized) { skippedNoPhone++; continue; }
      if (existingPhones.has(phone_normalized)) { duplicates++; continue; }

      const address = get('address');
      // The Maps column arrives either as a raw Place ID ("ChIJ…") or as a
      // ready-made link, depending on how the list was exported. Accept both:
      // a value that's already a URL is used as-is, otherwise it's an ID and
      // gets wrapped into a Maps lookup.
      const placeRaw = get('place_id');
      const placeUrl = !placeRaw
        ? ''
        : /^https?:\/\//i.test(placeRaw)
          ? placeRaw
          : `https://www.google.com/maps/place/?q=place_id:${placeRaw}`;

      const info = insert.run({
        business_name: get('business_name'),
        contact_name: get('contact_name'),
        owner_name: get('owner_name'),
        website: get('website'),
        // Prefer an explicitly mapped Maps URL column; otherwise fall back to
        // whatever the Place ID column resolved to above.
        google_maps_url: get('google_maps_url') || placeUrl,
        working_hours: get('working_hours'),
        phone,
        phone_normalized,
        phone_2: get('phone_2'),
        email: get('email'),
        address,
        city: titleCase(get('city')),
        // A scraped list is usually all one state/niche ("Roofers in Texas")
        // with no such column in the file — fall back to parsing the address,
        // then to the import screen's defaults, rather than losing the state.
        state: get('state') || stateFromAddress(address) || defaults.state || '',
        niche: titleCase(get('niche')) || defaults.niche || '',
        source: get('source') || defaults.source || 'CSV Import',
        priority: priorityFromTier(get('priority_tier')) || defaults.priority || 'Warm',
        review_count: (() => { const n = parseInt(get('review_count').replace(/[^0-9]/g, ''), 10); return Number.isFinite(n) ? n : null; })(),
        rating: (() => { const n = parseFloat(get('rating')); return Number.isFinite(n) ? n : null; })(),
        lead_score: (() => { const n = parseInt(get('lead_score'), 10); return Number.isFinite(n) ? n : null; })(),
        missed_call_evidence: get('missed_call_evidence'),
        campaign: get('campaign') || defaults.campaign || '',
      });
      const noteText = get('notes');
      if (noteText) insertNote.run(info.lastInsertRowid, noteText);

      existingPhones.add(phone_normalized);
      imported++;
    }
  });
  tx();

  pending.delete(importId);
  res.json({ imported, duplicates, skippedNoPhone, total: records.length });
});

export default router;
