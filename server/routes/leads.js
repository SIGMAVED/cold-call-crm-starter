import { Router } from 'express';
import { db, PRIORITIES, ROLES, getStatuses, getOutcomes } from '../db/init.js';
import { normalizePhone } from '../phone.js';
import { isOpenOn } from '../hours.js';
import { timezoneForLead, localTimeInfo } from '../timezone.js';
import { reviewBandFilter, REVIEW_BANDS } from '../reviewBands.js';
import { geminiJson } from '../gemini.js';
import { dialFilterSql } from './analytics.js';

const router = Router();

const LEAD_COLUMNS = [
  'business_name', 'contact_name', 'owner_name', 'phone', 'phone_2', 'email',
  'website', 'google_maps_url', 'working_hours', 'address', 'city', 'state',
  'niche', 'source', 'status', 'priority', 'role', 'last_contact_date',
  'missed_call_evidence', 'country', 'website_quality', 'owner_name_source', 'entity_type', 'campaign',
];

// Columns the All Leads table is allowed to sort by. Anything not in here
// falls back to created_at, so a bad/hostile ?sort= can't reach the SQL.
const SORTABLE_COLUMNS = new Set([
  'business_name', 'contact_name', 'owner_name', 'phone', 'email', 'city', 'state', 'niche', 'source',
  'next_followup_date', 'call_count', 'review_count', 'rating', 'lead_score', 'created_at',
  'country', 'website_quality', 'owner_name_source', 'entity_type', 'campaign',
]);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// `local` is derived per request (it depends on the current time), never
// stored — it tells the UI what o'clock it is where this business actually is.
function serializeLead(row) {
  if (!row) return row;
  const timeZone = timezoneForLead(row.state, row.city, row.country);
  return {
    ...row,
    custom_fields: row.custom_fields ? JSON.parse(row.custom_fields) : {},
    local: timeZone ? localTimeInfo(timeZone, row.working_hours) : null,
  };
}

// GET /api/leads?search=&status=&priority=&city=&source=&dialedFrom=&dialedTo=&ids=1,2,3
router.get('/', (req, res) => {
  const { search, status, priority, city, state, niche, source, followupType, ownerFilter, dialedFrom, dialedTo, ids, country, websiteQuality, campaign } = req.query;

  if (ids) {
    const idList = String(ids).split(',').map((x) => parseInt(x, 10)).filter(Boolean);
    if (idList.length === 0) return res.json([]);
    const placeholders = idList.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM leads WHERE id IN (${placeholders})`).all(...idList);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return res.json(idList.map((id) => byId.get(id)).filter(Boolean).map(serializeLead));
  }

  const clauses = [];
  const params = [];

  if (search) {
    clauses.push('(business_name LIKE ? OR contact_name LIKE ? OR phone LIKE ? OR phone_2 LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (priority) { clauses.push('priority = ?'); params.push(priority); }
  if (city) { clauses.push('city = ?'); params.push(city); }
  if (state) { clauses.push('state = ?'); params.push(state); }
  if (niche) { clauses.push('niche = ?'); params.push(niche); }
  if (source) { clauses.push('source = ?'); params.push(source); }
  // Not just another filter: 'WA' means Washington in the US and Western
  if (country) { clauses.push('country = ?'); params.push(country); }
  if (websiteQuality) { clauses.push('website_quality = ?'); params.push(websiteQuality); }
  if (followupType) { clauses.push('followup_type = ?'); params.push(followupType); }
  if (campaign) { clauses.push('campaign = ?'); params.push(campaign); }
  if (ownerFilter === 'has') clauses.push("owner_name != ''");
  else if (ownerFilter === 'blank') clauses.push("owner_name = ''");
  if (req.query.websiteFilter === 'has') clauses.push("website != ''");
  else if (req.query.websiteFilter === 'blank') clauses.push("website = ''");

  // "Dialed" means a disposition was logged (a `notes` row with outcome
  // set) within the range — the same definition Analytics uses for dial
  // counts, so this filter's results stay consistent with those numbers.
  if (dialedFrom || dialedTo) {
    const dialedClauses = [dialFilterSql()];
    if (dialedFrom) { dialedClauses.push('date(created_at) >= ?'); params.push(dialedFrom); }
    if (dialedTo) { dialedClauses.push('date(created_at) <= ?'); params.push(dialedTo); }
    clauses.push(`id IN (SELECT lead_id FROM notes WHERE ${dialedClauses.join(' AND ')})`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  // Sorting happens in SQL (not on the fetched page) so it orders the whole
  // matching set rather than just whatever the LIMIT happened to return.
  // Whitelisted — the column name is interpolated, so it can never be raw input.
  const sortCol = SORTABLE_COLUMNS.has(req.query.sort) ? req.query.sort : 'created_at';
  const sortDir = String(req.query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // Empty/NULL values always sink to the bottom, so sorting by "Follow-up"
  // surfaces the leads that actually have one instead of a wall of blanks.
  const orderBy = `ORDER BY (${sortCol} IS NULL OR ${sortCol} = '') ASC, ${sortCol} ${sortDir}`;

  // Limit removed/increased to 10000 so all database leads are returned to the CRM UI
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10000;
  const rows = db.prepare(`SELECT * FROM leads ${where} ${orderBy} LIMIT ?`).all(...params, limit);
  res.json(rows.map(serializeLead));
});

// GET /api/leads/meta - distinct cities/sources for filter dropdowns
router.get('/meta', (req, res) => {
  const cities = db.prepare(`SELECT DISTINCT city FROM leads WHERE city != '' ORDER BY city`).all().map((r) => r.city);
  const states = db.prepare(`SELECT DISTINCT state FROM leads WHERE state != '' ORDER BY state`).all().map((r) => r.state);
  const niches = db.prepare(`SELECT DISTINCT niche FROM leads WHERE niche != '' ORDER BY niche`).all().map((r) => r.niche);
  const sources = db.prepare(`SELECT DISTINCT source FROM leads WHERE source != '' ORDER BY source`).all().map((r) => r.source);
  const countries = db.prepare(`SELECT DISTINCT country FROM leads WHERE country != '' ORDER BY country`).all().map((r) => r.country);
  const campaigns = db.prepare(`SELECT DISTINCT campaign FROM leads WHERE campaign != '' ORDER BY campaign`).all().map((r) => r.campaign);
  res.json({
    statuses: getStatuses().map((s) => s.name),
    priorities: PRIORITIES, roles: ROLES, cities, states, niches, sources, countries, campaigns,
    reviewBands: REVIEW_BANDS.map((b) => ({ key: b.key, label: b.label })),
  });
});

// GET /api/leads/queue/today
// The `status` filter scopes the second section (the pool of leads to work
// through) — defaulting to 'New', which is what it was hardcoded to before.
// It deliberately does NOT touch the follow-ups section: those are time-driven
// ("what's due today"), and filtering them by status would silently hide due
// follow-ups the moment the pool filter didn't match their status.
router.get('/queue/today', (req, res) => {
  const { priority, city, state, niche, status, reviewBand, minRating, ownerFilter, country } = req.query;
  const today = todayStr();

  // Size/quality filters apply identically to both sections, so build them once.
  const band = reviewBand ? reviewBandFilter(reviewBand) : null;
  const rating = parseFloat(minRating);
  const hasMinRating = Number.isFinite(rating);
  const applyExtras = (clauses, params) => {
    if (band) { clauses.push(band.clause); params.push(...band.params); }
    if (hasMinRating) { clauses.push('rating >= ?'); params.push(rating); }
    if (ownerFilter === 'has') clauses.push("owner_name != ''");
    else if (ownerFilter === 'blank') clauses.push("owner_name = ''");
    if (req.query.websiteFilter === 'has') clauses.push("website != ''");
    else if (req.query.websiteFilter === 'blank') clauses.push("website = ''");
    if (req.query.campaign) { clauses.push('campaign = ?'); params.push(req.query.campaign); }
  };

  const followupClauses = ["next_followup_date IS NOT NULL", "next_followup_date <= ?"];
  const followupParams = [today];
  if (priority) { followupClauses.push('priority = ?'); followupParams.push(priority); }
  if (city) { followupClauses.push('city = ?'); followupParams.push(city); }
  if (state) { followupClauses.push('state = ?'); followupParams.push(state); }
  if (niche) { followupClauses.push('niche = ?'); followupParams.push(niche); }
  if (country) { followupClauses.push('country = ?'); followupParams.push(country); }
  applyExtras(followupClauses, followupParams);
  const followups = db.prepare(
    `SELECT * FROM leads WHERE ${followupClauses.join(' AND ')} ORDER BY next_followup_date ASC`
  ).all(...followupParams);

  const freshClauses = ['status = ?'];
  const freshParams = [status || 'New'];
  if (priority) { freshClauses.push('priority = ?'); freshParams.push(priority); }
  if (city) { freshClauses.push('city = ?'); freshParams.push(city); }
  if (state) { freshClauses.push('state = ?'); freshParams.push(state); }
  if (niche) { freshClauses.push('niche = ?'); freshParams.push(niche); }
  if (country) { freshClauses.push('country = ?'); freshParams.push(country); }
  applyExtras(freshClauses, freshParams);
  const fresh = db.prepare(
    `SELECT * FROM leads WHERE ${freshClauses.join(' AND ')} ORDER BY created_at DESC`
  ).all(...freshParams);

  // Weekend (or any-day) calling: keep only businesses whose posted hours say
  // they're actually open that day. working_hours is free text, so this is
  // filtered in JS rather than SQL. Leads with no/unparseable hours are
  // excluded — dialing a closed business burns a dial and a lead.
  const openOn = req.query.openOn;
  const byOpenDay = (rows) => (openOn ? rows.filter((l) => isOpenOn(l.working_hours, openOn) === true) : rows);

  // "Callable now" builds a batch out of businesses where it's currently a
  // sane local hour — the whole point once one queue spans three time zones.
  // Leads with no state have no local time, so they're excluded rather than
  // guessed at.
  const callableNow = req.query.callableNow === '1';
  const byCallable = (rows) => (callableNow ? rows.filter((l) => l.local?.status === 'good') : rows);

  res.json({
    followups: byCallable(byOpenDay(followups).map(serializeLead)),
    fresh: byCallable(byOpenDay(fresh).map(serializeLead)),
  });
});

// GET /api/leads/kanban
router.get('/kanban', (req, res) => {
  const rows = db.prepare(`SELECT * FROM leads ORDER BY created_at DESC`).all();
  const board = Object.fromEntries(getStatuses().map((s) => [s.name, []]));
  for (const row of rows) {
    (board[row.status] ??= []).push(serializeLead(row));
  }
  res.json(board);
});

// GET /api/leads/dashboard/followups - the three buckets shown on the home screen
router.get('/dashboard/followups', (req, res) => {
  const today = todayStr();
  const weekOut = new Date();
  weekOut.setDate(weekOut.getDate() + 7);
  const weekOutStr = weekOut.toISOString().slice(0, 10);

  const overdue = db.prepare(
    `SELECT * FROM leads WHERE next_followup_date IS NOT NULL AND next_followup_date < ? ORDER BY next_followup_date ASC`
  ).all(today);
  const dueToday = db.prepare(
    `SELECT * FROM leads WHERE next_followup_date = ? ORDER BY business_name ASC`
  ).all(today);
  const upcoming = db.prepare(
    `SELECT * FROM leads WHERE next_followup_date > ? AND next_followup_date <= ? ORDER BY next_followup_date ASC`
  ).all(today, weekOutStr);

  res.json({ overdue: overdue.map(serializeLead), dueToday: dueToday.map(serializeLead), upcoming: upcoming.map(serializeLead) });
});

// GET /api/leads/stats
router.get('/stats', (req, res) => {
  const now = new Date();
  const today = todayStr();
  const dow = now.getDay() === 0 ? 7 : now.getDay(); // Mon=1..Sun=7
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - (dow - 1));
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const callsToday = db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE ${dialFilterSql()} AND date(created_at) = ?`
  ).get(today).c;

  const callsWeek = db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE ${dialFilterSql()} AND date(created_at) >= ?`
  ).get(weekStartStr).c;

  const connectOutcomes = getOutcomes().filter((o) => o.is_connect).map((o) => o.label);
  const connectPlaceholders = connectOutcomes.map(() => '?').join(',') || 'NULL';
  const connectsWeek = db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE outcome IN (${connectPlaceholders}) AND date(created_at) >= ?`
  ).get(...connectOutcomes, weekStartStr).c;

  const demosWeek = db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE outcome = 'Demo Booked' AND date(created_at) >= ?`
  ).get(weekStartStr).c;

  const connectRate = callsWeek > 0 ? Math.round((connectsWeek / callsWeek) * 100) : 0;

  const overdue = db.prepare(
    `SELECT COUNT(*) c FROM leads WHERE next_followup_date IS NOT NULL AND next_followup_date < ?`
  ).get(today).c;
  const dueToday = db.prepare(
    `SELECT COUNT(*) c FROM leads WHERE next_followup_date = ?`
  ).get(today).c;
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const upcoming = db.prepare(
    `SELECT COUNT(*) c FROM leads WHERE next_followup_date > ? AND next_followup_date <= ?`
  ).get(today, weekEnd.toISOString().slice(0, 10)).c;

  res.json({ callsToday, callsWeek, connectRate, demosWeek, overdue, dueToday, upcoming });
});

// GET /api/leads/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(serializeLead(row));
});

// GET /api/leads/:id/notes
router.get('/:id/notes', (req, res) => {
  const rows = db.prepare('SELECT * FROM notes WHERE lead_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(rows);
});

// POST /api/leads/:id/notes - manual free-text append
router.post('/:id/notes', (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'body required' });
  const info = db.prepare('INSERT INTO notes (lead_id, body) VALUES (?, ?)').run(req.params.id, body.trim());
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(note);
});

// POST /api/leads/:id/draft-email - Gemini drafts a follow-up email from the
// lead's call history. Returns { subject, body } for the rep to review and
// send manually — nothing here ever emails anyone. `notes` already holds
// both the rep's manual notes AND full call transcripts (persistTranscript
// writes transcripts there too), so one table gets us everything said.
router.post('/:id/draft-email', async (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'not found' });

  const notes = db.prepare('SELECT body, outcome, created_at, contact_role FROM notes WHERE lead_id = ? ORDER BY created_at DESC LIMIT 8').all(req.params.id);
  if (notes.length === 0) {
    return res.status(400).json({ error: 'This lead has no call notes or transcripts yet — nothing to draft from.' });
  }

  const history = notes
    .slice().reverse() // chronological, so the draft reads the conversation in order
    .map((n) => `--- ${n.created_at}${n.outcome ? ` (${n.outcome})` : ''}${n.contact_role ? ` [spoke to: ${n.contact_role}]` : ''} ---\n${n.body}`)
    .join('\n\n');

  // Set these to your own name and demo/CTA number before going live — both
  // get baked directly into the email copy generated below.
  const REP_NAME = process.env.REP_NAME || 'Alex';
  const DEMO_PHONE = process.env.DEMO_PHONE_NUMBER || '+1 (555) 123-4567';

  // Most cold-call pickups are a gatekeeper (receptionist/office staff), not
  // the owner — but the email is always addressed to the owner. Whether the
  // owner personally said anything determines whether "you mentioned X" is
  // even true; getting this wrong reads as either presumptuous (claiming the
  // owner said something a gatekeeper actually said) or oddly formal (playing
  // dumb about a real conversation that DID happen with the owner directly).
  const mostRecentRoleNote = notes.find((n) => n.contact_role);
  const spokeToOwner = mostRecentRoleNote?.contact_role === 'owner';
  const contactRoleContext = mostRecentRoleNote
    ? spokeToOwner
      ? "The call history above was WITH THE OWNER directly — attribute anything specific to them personally (\"you mentioned...\", \"when we spoke...\") freely, it's accurate."
      : `The call history above was with a ${mostRecentRoleNote.contact_role} (gatekeeper/office staff), NOT the owner — the owner has not personally spoken to ${REP_NAME} yet. Never write "you mentioned X" or "when we spoke" as if addressing someone who was on that call — the owner reading this email wasn't. Instead attribute details to the team/office ("your office mentioned...", "I heard from your team that...", "someone at ${lead.business_name || 'your shop'} let me know...") and frame this as ${REP_NAME}'s first direct outreach to the owner specifically.`
    : "No contact_role was recorded for these calls — if the history reads like an owner's own words (deciding, negotiating, speaking with authority about the business) treat it as the owner; if it reads like a receptionist/dispatcher taking a message, treat it as a gatekeeper and follow the gatekeeper attribution rule.";

  // The email field is sometimes a rep's mid-call placeholder reminder
  // ("check the transcript", "its in website") rather than a real address —
  // written when they didn't have time to grab it and meant to fix it later.
  // Trust it only if it actually looks like an email; otherwise ask Gemini to
  // pull the real one out of the transcript itself (receptionists reading an
  // email out loud, like "office@reliantacguys.com", show up there often).
  const suppliedEmail = (req.body?.email || lead.email || '').trim();
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(suppliedEmail);
  const recipientEmail = looksLikeEmail ? suppliedEmail : '';

  const prompt = `${REP_NAME} cold-calls businesses for his own company. He is drafting a short ` +
    `follow-up email after calling one of his LEADS (a prospect, not his own employer).

WHO IS WHO — read this carefully, transcripts frequently cause confusion here:
- ${REP_NAME} = the caller. He does NOT work for the lead's business, and the
  email must never claim otherwise.
- "${lead.business_name || 'the lead'}" = the LEAD, the business ${REP_NAME} called. Any line
  right after "Prospect: Hello?" (or similar) that sounds like a business
  answering the phone — "Thank you for calling ${lead.business_name || '[business]'}",
  "This is [name], how can I help you?", a recording disclaimer — is the
  LEAD'S OWN staff/system answering ${REP_NAME}'s call. Even though the
  transcript labels these lines "You:", they are what ${REP_NAME} HEARD, not
  what he said. Do not sign the email as if ${REP_NAME} works there.
- The email must be written FROM ${REP_NAME} TO someone at the lead's business.

LEAD:
Business: ${lead.business_name || 'Unknown'}
Contact: ${lead.contact_name || lead.owner_name || 'Unknown'}
Industry: ${lead.niche || 'Unknown'}
Website: ${lead.website || 'None'}
Recipient email on file: ${recipientEmail || 'MISSING — the field on file was not a real address. Search the call history below for one being read aloud (e.g. a receptionist spelling out an address) and use that exact address, reconstructed correctly.'}

WHO WAS ACTUALLY ON THE CALL: ${contactRoleContext}

CALL HISTORY (oldest first — includes rep notes and call transcripts, tagged with who ${REP_NAME} spoke to when known):
${history}

INSTRUCTIONS FOR THE EMAIL BODY — write it the way Alex Hormozi teaches cold
outbound copy, not the way a corporate rep writes a business letter:
- HARD LENGTH CEILING: 60-90 words total, body only. Nobody reads a cold
  email like a book — if a paragraph is reaching a 3rd sentence, cut it.
  Short beats complete. When in doubt, delete a sentence.
- FIRST LINE MUST BE ONE SPECIFIC, CONCRETE DETAIL PULLED FROM THE CALL
  HISTORY ABOVE — something the prospect actually said: a tool they use
  (Housecall Pro, ServiceTitan, an answering service), a specific complaint,
  their hours, how they currently handle missed calls, a competitor, an
  objection they raised. This is the entire point — it's proof a real person
  was on that call with them, not a template. If the transcript genuinely has
  nothing usable, reference ${lead.business_name || 'their shop'} and ${lead.niche || 'their trade'} specifically instead — never a generic opener like
  "It was great speaking with you" or "I hope this finds you well." Attribute
  the detail correctly per the WHO WAS ACTUALLY ON THE CALL note above — don't
  tell the owner "you said X" if it was actually their gatekeeper who said it.
- One idea per sentence, no sentence over ~20 words. Paragraphs are 1-2
  sentences, never 3+. Plain, spoken language — write like you're texting
  someone you respect, not "reaching out to follow up." Ban corporate words:
  "solution," "leverage," "synergy," "circle back," "touch base."
- Skip all throat-clearing. Get to the point inside the first line.
- ONE ask, ultra-low-commitment: no Zoom call, no calendar link. Tell them to
  dial ${DEMO_PHONE} right now and pretend to be a customer with an
  emergency — that's the entire CTA, stated once, plainly.
- Close with a P.S. line that restates the ask in one short sentence — that's
  the line people actually read, so it has to carry weight, not repeat filler.
- ABSOLUTELY NO META-TALK: Never write phrases like "As mentioned, I am sending an email to...", "I am following up as promised to send an email...", or "I'll send my inquiry to...". Write ONLY the exact email message that the prospect reads.
- Sign off cleanly as:
Thanks,
${REP_NAME}
- Subject line: short and specific (under 6 words), curiosity or the concrete
  detail from the opener — not "Follow-up regarding our call."
- "to" field must be the recipient email address.
- Output strictly as JSON: {"subject": "...", "body": "...", "to": "..."} — body uses \\n for line breaks, no markdown.`;

  try {
    const draft = await geminiJson(prompt, {
      schema: {
        type: 'object',
        properties: { subject: { type: 'string' }, body: { type: 'string' }, to: { type: 'string' } },
        required: ['subject', 'body', 'to'],
      },
    });
    // Belt-and-suspenders: never hand back something that isn't a real
    // address even if the model didn't follow the instruction.
    const finalTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.to || '') ? draft.to : recipientEmail;
    res.json({ subject: draft.subject, body: draft.body, to: finalTo });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/leads - create
router.post('/', (req, res) => {
  const b = req.body || {};
  const phone_normalized = normalizePhone(b.phone, b.country || 'US');
  if (phone_normalized) {
    const dup = db.prepare('SELECT id FROM leads WHERE phone_normalized = ?').get(phone_normalized);
    if (dup) return res.status(409).json({ error: 'duplicate phone', existingId: dup.id });
  }
  const info = db.prepare(`
    INSERT INTO leads (business_name, contact_name, owner_name, phone, phone_normalized, phone_2, email, website, google_maps_url, working_hours, address, city, state, niche, source, status, priority, next_followup_date, review_count, rating, lead_score, missed_call_evidence, country, website_quality, owner_name_source, entity_type)
    VALUES (@business_name, @contact_name, @owner_name, @phone, @phone_normalized, @phone_2, @email, @website, @google_maps_url, @working_hours, @address, @city, @state, @niche, @source, @status, @priority, @next_followup_date, @review_count, @rating, @lead_score, @missed_call_evidence, @country, @website_quality, @owner_name_source, @entity_type)
  `).run({
    business_name: b.business_name || '',
    contact_name: b.contact_name || '',
    owner_name: b.owner_name || '',
    phone: b.phone || '',
    phone_normalized,
    phone_2: b.phone_2 || '',
    email: b.email || '',
    website: b.website || '',
    google_maps_url: b.google_maps_url || '',
    working_hours: b.working_hours || '',
    address: b.address || '',
    city: b.city || '',
    state: b.state || '',
    niche: b.niche || '',
    source: b.source || '',
    status: b.status || 'New',
    priority: b.priority || 'Warm',
    next_followup_date: b.next_followup_date || null,
    review_count: Number.isFinite(parseInt(b.review_count, 10)) ? parseInt(b.review_count, 10) : null,
    rating: Number.isFinite(parseFloat(b.rating)) ? parseFloat(b.rating) : null,
    lead_score: Number.isFinite(parseInt(b.lead_score, 10)) ? parseInt(b.lead_score, 10) : null,
    missed_call_evidence: b.missed_call_evidence || '',
    country: b.country || 'US',
    website_quality: ['none', 'bad', 'good'].includes(b.website_quality) ? b.website_quality : null,
    owner_name_source: ['verified', 'website', 'abn_registry', 'review'].includes(b.owner_name_source) ? b.owner_name_source : null,
    entity_type: b.entity_type || null,
  });
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serializeLead(row));
});

// PATCH /api/leads/:id - autosave field updates
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const updates = {};
  for (const col of LEAD_COLUMNS) {
    if (col in req.body) updates[col] = req.body[col];
  }
  // review_count is an integer column — keep a blank input as NULL rather than
  // an empty string, which would poison numeric sorting.
  if ('review_count' in updates) {
    const n = parseInt(updates.review_count, 10);
    updates.review_count = Number.isFinite(n) ? n : null;
  }
  if ('lead_score' in updates) {
    const n = parseInt(updates.lead_score, 10);
    updates.lead_score = Number.isFinite(n) ? n : null;
  }
  if ('rating' in updates) {
    const n = parseFloat(updates.rating);
    updates.rating = Number.isFinite(n) ? n : null;
  }
  // Keep NULL meaning "not evaluated" distinct from an empty-string typo —
  // anything that isn't one of the three real values collapses back to NULL.
  if ('website_quality' in updates) {
    updates.website_quality = ['none', 'bad', 'good'].includes(updates.website_quality) ? updates.website_quality : null;
  }
  if ('owner_name_source' in updates) {
    updates.owner_name_source = ['verified', 'website', 'abn_registry', 'review'].includes(updates.owner_name_source) ? updates.owner_name_source : null;
  }
  if ('phone' in updates) {
    // A country change and a phone edit can land in the same PATCH — prefer
    // whichever country this request is actually setting, fall back to the
    // lead's existing one.
    const effectiveCountry = 'country' in updates ? updates.country : existing.country;
    const phone_normalized = normalizePhone(updates.phone, effectiveCountry || 'US');
    if (phone_normalized) {
      const dup = db.prepare('SELECT id FROM leads WHERE phone_normalized = ? AND id != ?').get(phone_normalized, req.params.id);
      if (dup) return res.status(409).json({ error: 'duplicate phone', existingId: dup.id });
    }
    updates.phone_normalized = phone_normalized;
  }
  if (req.body.custom_fields && typeof req.body.custom_fields === 'object') {
    const existingCF = existing.custom_fields ? JSON.parse(existing.custom_fields) : {};
    updates.custom_fields = JSON.stringify({ ...existingCF, ...req.body.custom_fields });
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) return res.json(serializeLead(existing));

  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE leads SET ${setClause} WHERE id = @id`).run({ ...updates, id: req.params.id });
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  res.json(serializeLead(row));
});

// DELETE /api/leads/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// POST /api/leads/bulk-delete - body: { ids: [1,2,3] }
router.post('/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => parseInt(x, 10)).filter(Boolean) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ids required' });
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(`DELETE FROM leads WHERE id IN (${placeholders})`).run(...ids);
  res.json({ deleted: info.changes });
});

// POST /api/leads/:id/log-call - the core outcome-logging action used by
// both the Today's Queue quick-log panel and the Active Session view.
router.post('/:id/log-call', (req, res) => {
  const { outcome, note_text, next_followup_date, followup_type, email,
          contact_role, presented, appointment_set } = req.body;
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const outcomeDef = db.prepare('SELECT * FROM outcomes WHERE label = ?').get(outcome);
  if (!outcomeDef) return res.status(400).json({ error: 'invalid outcome' });

  // Funnel fields. Anything not supplied stays NULL — "not recorded" has to
  // remain distinguishable from an explicit "no", otherwise unattended dials
  // would silently look like failed pitches and drag the rates down.
  const ROLES_ALLOWED = ['owner', 'gatekeeper', 'other'];
  const resolvedRole = ROLES_ALLOWED.includes(String(contact_role).toLowerCase())
    ? String(contact_role).toLowerCase() : null;
  const toFlag = (v) => (v === true || v === 1 ? 1 : v === false || v === 0 ? 0 : null);
  const resolvedPresented = toFlag(presented);
  // Booking a meeting is itself proof an appointment was set, so the
  // disposition implies the flag even when the rep didn't tap it.
  const resolvedAppointment = toFlag(appointment_set) ?? (outcome === 'Meeting Booked' ? 1 : null);

  const now = new Date().toISOString();
  const status = outcomeDef.status;
  const resolvedFollowupType = ['call', 'email'].includes(followup_type) ? followup_type : null;
  // An email captured mid-call (a gatekeeper handing over the owner's address)
  // is worth keeping even if it arrives with a non-follow-up disposition.
  const resolvedEmail = typeof email === 'string' && email.trim() ? email.trim() : null;

  let body = note_text && note_text.trim() ? note_text.trim() : `Outcome: ${outcome}`;
  if (resolvedFollowupType === 'email' && resolvedEmail) {
    body += `\nEmail follow-up to: ${resolvedEmail}`;
  }

  // Capitalised form for leads.role, which predates the lowercase note values.
  const leadRole = resolvedRole
    ? { owner: 'Owner', gatekeeper: 'Gatekeeper', other: null }[resolvedRole]
    : null;

  // Email Sent logs through this same endpoint (so it gets an activity-feed
  // entry and can flip lead status) but it isn't a phone call — call_count is
  // a dial counter, not a "times touched" counter, so it must not increment
  // for it.
  const callCountSql = outcome === 'Email Sent' ? 'call_count' : 'call_count + 1';

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO notes (lead_id, body, outcome, contact_role, presented, appointment_set, metrics_source)
      VALUES (?, ?, ?, ?, ?, ?, 'live')
    `).run(req.params.id, body, outcome, resolvedRole, resolvedPresented, resolvedAppointment);
    db.prepare(`
      UPDATE leads
      SET status = ?, last_contact_date = ?, call_count = ${callCountSql},
          next_followup_date = ?,
          followup_type = ?,
          email = COALESCE(?, email),
          role = COALESCE(?, role)
      WHERE id = ?
    `).run(
      status,
      now.slice(0, 10),
      next_followup_date || null,
      resolvedFollowupType,
      resolvedEmail,
      leadRole,
      req.params.id
    );
  });
  tx();

  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  // Today's running dial total (same definition as Analytics' todayDials),
  // so the client can celebrate the moment a daily goal is crossed.
  const todayDials = db.prepare(
    `SELECT COUNT(*) c FROM notes WHERE ${dialFilterSql()} AND date(created_at) = ?`
  ).get(todayStr()).c;
  res.json({ ...serializeLead(row), todayDials });
});

export default router;
