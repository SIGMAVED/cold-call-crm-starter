import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'crm.sqlite');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone_normalized TEXT NOT NULL DEFAULT '',
  phone_2 TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'New',
  priority TEXT NOT NULL DEFAULT 'Warm',
  last_contact_date TEXT,
  next_followup_date TEXT,
  call_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_phone_normalized
  ON leads(phone_normalized) WHERE phone_normalized != '';

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads(priority);
CREATE INDEX IF NOT EXISTS idx_leads_next_followup ON leads(next_followup_date);
CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  outcome TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_lead_id ON notes(lead_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at);

CREATE TABLE IF NOT EXISTS statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT 'badge-neutral',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  is_connect INTEGER NOT NULL DEFAULT 0,
  needs_followup INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  lead_count INTEGER NOT NULL DEFAULT 0,
  dial_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);

CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  metric TEXT NOT NULL DEFAULT 'dials',
  target_count INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS upwork_proposals (
  date TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT NOT NULL UNIQUE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'outbound',
  from_number TEXT NOT NULL DEFAULT '',
  to_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'initiated',
  duration_sec INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_calls_lead_id ON calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at);

CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transcripts_call_id ON transcripts(call_id);

CREATE TABLE IF NOT EXISTS dnc_numbers (
  phone_normalized TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migration: leads table predates the custom_fields/role columns.
const leadColumns = db.prepare("PRAGMA table_info(leads)").all().map((c) => c.name);
if (!leadColumns.includes('custom_fields')) {
  db.exec("ALTER TABLE leads ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}'");
}
if (!leadColumns.includes('role')) {
  db.exec('ALTER TABLE leads ADD COLUMN role TEXT');
}
if (!leadColumns.includes('dnc')) {
  db.exec('ALTER TABLE leads ADD COLUMN dnc INTEGER NOT NULL DEFAULT 0');
}
// How the next follow-up should happen: 'call' or 'email'. Set when the rep
// logs a "Follow up scheduled" disposition — a prospect who hands over the
// owner's email needs an email, not another dial, and the queue has to say so.
if (!leadColumns.includes('followup_type')) {
  db.exec('ALTER TABLE leads ADD COLUMN followup_type TEXT');
}
// Google review count from the scrape — a proxy for how established the
// business is. NULL when unknown (manually added leads / older imports).
if (!leadColumns.includes('review_count')) {
  db.exec('ALTER TABLE leads ADD COLUMN review_count INTEGER');
}
// Business owner's name (often "Possible Owner Name" in scraped data), kept
// separate from contact_name — the person who actually answered may not be
// the owner, and knowing the owner's name helps get past the gatekeeper.
if (!leadColumns.includes('owner_name')) {
  db.exec("ALTER TABLE leads ADD COLUMN owner_name TEXT NOT NULL DEFAULT ''");
}
// Business website from the scrape — useful to glance at mid-call to sound
// informed ("I saw on your site you do commercial HVAC too...").
if (!leadColumns.includes('website')) {
  db.exec("ALTER TABLE leads ADD COLUMN website TEXT NOT NULL DEFAULT ''");
}
// Google Maps listing URL and posted working hours from the scrape — the
// hours matter mid-dial (are they even open right now?), and the Maps link
// is a faster way to pull up reviews/photos than searching the name again.
if (!leadColumns.includes('google_maps_url')) {
  db.exec("ALTER TABLE leads ADD COLUMN google_maps_url TEXT NOT NULL DEFAULT ''");
}
if (!leadColumns.includes('working_hours')) {
  db.exec("ALTER TABLE leads ADD COLUMN working_hours TEXT NOT NULL DEFAULT ''");
}
// The industry/vertical being prospected (HVAC, Roofing, Plumbing…). Kept
// separate from `source` — source is where the list came from, niche is what
// the business does, and the two vary independently once you work more than
// one vertical. Drives per-niche performance analytics and queue targeting.
if (!leadColumns.includes('niche')) {
  db.exec("ALTER TABLE leads ADD COLUMN niche TEXT NOT NULL DEFAULT ''");
}
// Google star rating (4.6) — sits alongside review_count as a quick read on
// how established a business is. NULL when the scrape didn't have one.
if (!leadColumns.includes('rating')) {
  db.exec('ALTER TABLE leads ADD COLUMN rating REAL');
}
// Scrape-side lead score (0-8 in the current lists). Higher = better fit, so
// the queue can be worked best-first instead of in import order.
if (!leadColumns.includes('lead_score')) {
  db.exec('ALTER TABLE leads ADD COLUMN lead_score INTEGER');
}
// A verbatim review quote showing this business misses calls ("called and no
// one picked up"). This is the single strongest opener we have — it's the
// prospect's own customer describing the problem being sold against — so it
// gets its own field and is surfaced during the call, not buried in notes.
if (!leadColumns.includes('missed_call_evidence')) {
  db.exec("ALTER TABLE leads ADD COLUMN missed_call_evidence TEXT NOT NULL DEFAULT ''");
}
// Multi-market expansion (US + Australia). DEFAULT 'US' backfills every
// existing row correctly on its own — they genuinely are all US, this isn't
// a guess. 'WA' collides between Washington (US) and Western Australia (AU),
// so anything that resolves a US state code (timezone, future state-name
// normalization) must branch on country first — see timezone.js.
if (!leadColumns.includes('country')) {
  db.exec("ALTER TABLE leads ADD COLUMN country TEXT NOT NULL DEFAULT 'US'");
}
// 'none' | 'bad' | 'good', set by whatever checks the lead's website before
// routing it to a pitch. NULL (the default) means "not evaluated yet" —
// deliberately never backfilled from `website != ''` for historical rows,
// since a non-empty URL was never actually judged good vs. dead/parked
// before this field existed. Leave old rows NULL rather than fabricate it.
if (!leadColumns.includes('website_quality')) {
  db.exec('ALTER TABLE leads ADD COLUMN website_quality TEXT');
}
// How sure we actually are that owner_name is the real owner. Four sources,
// very different reliability: 'abn_registry' (AU government business-number
// registry — the registered proprietor/partner, effectively a legal record,
// highest trust); 'website' (a business's own About/Team page via Firecrawl);
// 'review' (pattern-matching a first name out of a Google review, e.g.
// "Justin arrived and installed..." — could be staff, not the owner, and the
// heuristic sometimes catches generic words like "Technician" or "Crew" as
// if they were names, lowest trust of the automated methods); 'verified' is
// for names a human actually confirmed by hand. NULL means unknown/not
// tracked — left
// unbackfilled for existing owner_name values on purpose, same reasoning as
// website_quality above: we don't actually know how those were sourced, so
// guessing a tier would fabricate confidence that was never earned.
if (!leadColumns.includes('owner_name_source')) {
  db.exec('ALTER TABLE leads ADD COLUMN owner_name_source TEXT');
}
// Registered legal structure from AU's ABN business registry (e.g.
// 'Individual/Sole Trader', 'Family Partnership', 'Australian Private
// Company', 'Discretionary Trading Trust'). Free text, not an enum — the
// registry has more categories than are worth hardcoding a picklist for.
// Genuinely useful signal, not just metadata: Sole Trader/Family Partnership
// are strong owner-operator indicators, the same thing review_count and
// missed_call_evidence are already used as proxies for elsewhere in this
// CRM — this one just comes from a government record instead of a guess.
// US leads will never have this (no equivalent registry integrated), so it
// stays NULL for them rather than an empty string.
if (!leadColumns.includes('entity_type')) {
  db.exec('ALTER TABLE leads ADD COLUMN entity_type TEXT');
}

// Filtering/grouping by state and niche happens on every queue build and on
// the analytics segment charts, so index them like city already is.
db.exec('CREATE INDEX IF NOT EXISTS idx_leads_state ON leads(state)');
db.exec('CREATE INDEX IF NOT EXISTS idx_leads_niche ON leads(niche)');
db.exec('CREATE INDEX IF NOT EXISTS idx_leads_lead_score ON leads(lead_score)');
db.exec('CREATE INDEX IF NOT EXISTS idx_leads_country ON leads(country)');

if (!leadColumns.includes('campaign')) {
  db.exec("ALTER TABLE leads ADD COLUMN campaign TEXT NOT NULL DEFAULT ''");
}
db.exec('CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign)');


// Migration: targets table predates the metric column (was dials-only,
// column named target_dials). Rename it to the generic target_count and
// add metric so a target can measure dials or conversations.
const targetColumns = db.prepare("PRAGMA table_info(targets)").all().map((c) => c.name);
if (targetColumns.includes('target_dials') && !targetColumns.includes('target_count')) {
  db.exec('ALTER TABLE targets RENAME COLUMN target_dials TO target_count');
}
if (!db.prepare("PRAGMA table_info(targets)").all().map((c) => c.name).includes('metric')) {
  db.exec("ALTER TABLE targets ADD COLUMN metric TEXT NOT NULL DEFAULT 'dials'");
}
// A recurring target (currently just 'weekly') has its start/end recomputed
// on every read to always be the current period — e.g. a "1000 dials/week"
// target re-anchors to this week's Mon-Fri every time it's fetched, instead
// of needing a new row created (and the old one going stale) every week.
if (!db.prepare("PRAGMA table_info(targets)").all().map((c) => c.name).includes('recurring')) {
  db.exec('ALTER TABLE targets ADD COLUMN recurring TEXT');
}
if (!db.prepare("PRAGMA table_info(targets)").all().map((c) => c.name).includes('campaign')) {
  db.exec("ALTER TABLE targets ADD COLUMN campaign TEXT");
}

// Migration: calls table predates call recording. Twilio hosts the audio and
// hands us back a URL once the recording is ready; we only store the pointer.
const callColumns = db.prepare("PRAGMA table_info(calls)").all().map((c) => c.name);
if (!callColumns.includes('recording_sid')) {
  db.exec('ALTER TABLE calls ADD COLUMN recording_sid TEXT');
}
if (!callColumns.includes('recording_url')) {
  db.exec('ALTER TABLE calls ADD COLUMN recording_url TEXT');
}
if (!callColumns.includes('recording_duration_sec')) {
  db.exec('ALTER TABLE calls ADD COLUMN recording_duration_sec INTEGER');
}

// Funnel metrics live on the disposition, not the lead: one lead can be called
// repeatedly and reach a different person each time, so "who did I reach" and
// "did I actually pitch" are facts about a CALL. `leads.role` is kept in sync
// with the latest value so existing queue filters keep working, but
// notes.contact_role is the source of truth.
// All nullable on purpose — NULL means "not recorded", which must stay
// distinguishable from 0/"no".
const noteColumns = db.prepare('PRAGMA table_info(notes)').all().map((c) => c.name);
if (!noteColumns.includes('contact_role')) {
  db.exec('ALTER TABLE notes ADD COLUMN contact_role TEXT'); // owner|gatekeeper|other
}
if (!noteColumns.includes('presented')) {
  // 1 only when the full pitch was delivered AND an explicit ask was made.
  db.exec('ALTER TABLE notes ADD COLUMN presented INTEGER');
}
if (!noteColumns.includes('appointment_set')) {
  db.exec('ALTER TABLE notes ADD COLUMN appointment_set INTEGER');
}
if (!noteColumns.includes('metrics_source')) {
  // 'live' = typed during the call, 'backfill' = inferred from history.
  db.exec('ALTER TABLE notes ADD COLUMN metrics_source TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_notes_contact_role ON notes(contact_role)');
db.exec('CREATE INDEX IF NOT EXISTS idx_notes_presented ON notes(presented)');

// Seed statuses/outcomes with the original hardcoded defaults on first run.
// "Couldn't Connect" folds in wrong-number call attempts; "Rejected" /
// "We are good" style rejections are logged under "Not Interested" (the
// specific reason goes in the note). "Follow-up / Positive" is the old
// "Callback Requested" bucket.
if (db.prepare('SELECT COUNT(*) c FROM statuses').get().c === 0) {
  const insertStatus = db.prepare('INSERT INTO statuses (name, color, sort_order) VALUES (?, ?, ?)');
  const DEFAULT_STATUSES = [
    ['New', 'badge-info'], ['Attempted', 'badge-neutral'], ['No Answer', 'badge-neutral'],
    ["Couldn't Connect", 'badge-neutral'], ['Voicemail Left', 'badge-info'], ['IVR', 'badge-neutral'],
    ['Hotline', 'badge-neutral'], ['AI', 'badge-neutral'], ['Gatekeeper', 'badge-warn'],
    ['Callback Requested', 'badge-warn'], ['Demo Booked', 'badge-success'], ['Not Interested', 'badge-danger'],
    ['Cold', 'badge-neutral'], ['Client Won', 'badge-success'],
  ];
  DEFAULT_STATUSES.forEach(([name, color], i) => insertStatus.run(name, color, i));
}

if (db.prepare('SELECT COUNT(*) c FROM outcomes').get().c === 0) {
  const insertOutcome = db.prepare(`
    INSERT INTO outcomes (label, status, key, is_connect, needs_followup, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const DEFAULT_OUTCOMES = [
    ['No Answer', 'No Answer', '1', 0, 0],
    ['Voicemail', 'Voicemail Left', '2', 0, 0],
    ['IVR', 'IVR', '3', 0, 0],
    ['Hotline', 'Hotline', '4', 0, 0],
    ['AI', 'AI', '5', 0, 0],
    ["Couldn't Connect", "Couldn't Connect", '6', 0, 0],
    ['Gatekeeper', 'Gatekeeper', '7', 1, 0],
    ['Not Interested', 'Not Interested', '8', 1, 0],
    ['Follow-up / Positive', 'Callback Requested', '9', 1, 1],
    ['Demo Booked', 'Demo Booked', '0', 1, 0],
  ];
  DEFAULT_OUTCOMES.forEach(([label, status, key, is_connect, needs_followup], i) =>
    insertOutcome.run(label, status, key, is_connect, needs_followup, i));
}

// One-time migration: replace the original call-outcome defaults with the
// stricter per-dial Call Disposition taxonomy the analytics dashboard is
// built on, and add the pipeline statuses those dispositions drive leads
// into. Guarded by a meta flag so it runs exactly once, even across
// restarts, and won't clobber outcomes/statuses added later via Settings.
if (!db.prepare("SELECT value FROM meta WHERE key = 'dispositions_v2'").get()) {
  const NEW_STATUSES = [
    ['Voicemail', 'badge-info'],
    ['No Contact - IVR', 'badge-neutral'],
    ['No Contact - Answering Service', 'badge-neutral'],
    ['Gatekeeper Blocked', 'badge-warn'],
    ['Rejected (Dead)', 'badge-danger'],
    ['Follow-Up Scheduled', 'badge-warn'],
    ['Bad Data', 'badge-danger'],
    ['Qualified / Hot Lead', 'badge-success'],
  ];
  const insertStatusIfMissing = db.prepare('INSERT OR IGNORE INTO statuses (name, color, sort_order) VALUES (?, ?, ?)');
  const maxStatusOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM statuses').get().m;
  NEW_STATUSES.forEach(([name, color], i) => insertStatusIfMissing.run(name, color, maxStatusOrder + 1 + i));

  const OLD_DEFAULT_OUTCOME_LABELS = [
    'No Answer', 'Voicemail', 'IVR', 'Hotline', 'AI', "Couldn't Connect",
    'Gatekeeper', 'Not Interested', 'Follow-up / Positive', 'Demo Booked',
  ];
  const deleteOutcome = db.prepare('DELETE FROM outcomes WHERE label = ?');
  OLD_DEFAULT_OUTCOME_LABELS.forEach((label) => deleteOutcome.run(label));

  // Per-dial Call Dispositions. is_connect marks the four that count as a
  // "Human Interaction" for Connect Rate; needs_followup prompts for a
  // follow-up date (only Connected - Follow Up).
  const DISPOSITIONS = [
    ['Direct to Voicemail', 'Voicemail', '1', 0, 0],
    ['Ring to Voicemail', 'Voicemail', '2', 0, 0],
    ['IVR / Phone Tree', 'No Contact - IVR', '3', 0, 0],
    ['Answering Service / Dispatch', 'No Contact - Answering Service', '4', 0, 0],
    ['Gatekeeper - Blocked', 'Gatekeeper Blocked', '5', 1, 0],
    ['Immediate Hangup', 'Rejected (Dead)', '6', 1, 0],
    ['Connected - Pitched (No)', 'Rejected (Dead)', '7', 1, 0],
    ['Connected - Follow Up', 'Follow-Up Scheduled', '8', 1, 1],
    ['Junk Data (Bad/Disconnected Number)', 'Bad Data', '9', 0, 0],
  ];
  const insertOutcomeIfMissing = db.prepare(`
    INSERT OR IGNORE INTO outcomes (label, status, key, is_connect, needs_followup, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  DISPOSITIONS.forEach(([label, status, key, is_connect, needs_followup], i) =>
    insertOutcomeIfMissing.run(label, status, key, is_connect, needs_followup, i));

  db.prepare("INSERT INTO meta (key, value) VALUES ('dispositions_v2', '1')").run();
}

// One-time migration: pare the disposition list down to the 8 the rep
// actually uses in Active Session, and prune the pipeline status list down
// to exactly what those 8 (plus New/Converted) need. Renames carry existing
// leads and outcomes forward (UPDATE, not delete) so history isn't lost;
// statuses with no equivalent in the new set are simply removed from the
// picklist — any lead already sitting on one keeps its status text as-is,
// it just won't appear as a manageable status going forward.
if (!db.prepare("SELECT value FROM meta WHERE key = 'dispositions_v3'").get()) {
  function renameStatus(oldName, newName, color) {
    const existing = db.prepare('SELECT * FROM statuses WHERE name = ?').get(oldName);
    if (!existing) return;
    db.prepare('UPDATE leads SET status = ? WHERE status = ?').run(newName, oldName);
    db.prepare('UPDATE outcomes SET status = ? WHERE status = ?').run(newName, oldName);
    db.prepare('UPDATE statuses SET name = ?, color = COALESCE(?, color) WHERE id = ?').run(newName, color || null, existing.id);
  }

  renameStatus('Rejected (Dead)', 'Rejected', 'badge-danger');
  renameStatus('Qualified / Hot Lead', 'Meeting Booked', 'badge-success');
  renameStatus('Client Won', 'Converted', 'badge-success');

  const FINAL_STATUSES = [
    'New', 'Voicemail', "Couldn't Connect", 'Bad Data', 'Hotline',
    'Follow-Up Scheduled', 'Rejected', 'Meeting Booked', 'Converted', 'Email Sent',
  ];
  const allStatuses = db.prepare('SELECT name FROM statuses').all().map((r) => r.name);
  const deleteStatus = db.prepare('DELETE FROM statuses WHERE name = ?');
  allStatuses.forEach((name) => {
    if (!FINAL_STATUSES.includes(name)) deleteStatus.run(name);
  });

  db.exec('DELETE FROM outcomes');
  const insertOutcome = db.prepare(`
    INSERT INTO outcomes (label, status, key, is_connect, needs_followup, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const NEW_DISPOSITIONS = [
    ['Ring to Voicemail', 'Voicemail', '1', 0, 0],
    ['Direct Voicemail', 'Voicemail', '2', 0, 0],
    ["Couldn't Connect / Busy", "Couldn't Connect", '3', 0, 0],
    ['Bad Data / Wrong Number', 'Bad Data', '4', 0, 0],
    ['Hotline', 'Hotline', '5', 0, 0],
    ['Follow up scheduled', 'Follow-Up Scheduled', '6', 1, 1],
    ['Rejected', 'Rejected', '7', 1, 0],
    ['Meeting Booked', 'Meeting Booked', '8', 1, 0],
    ['Email Sent', 'Email Sent', 'e', 1, 0],
  ];
  NEW_DISPOSITIONS.forEach(([label, status, key, is_connect, needs_followup], i) =>
    insertOutcome.run(label, status, key, is_connect, needs_followup, i));

  db.prepare("INSERT INTO meta (key, value) VALUES ('dispositions_v3', '1')").run();
}

if (!db.prepare("SELECT value FROM meta WHERE key = 'dispositions_v4'").get()) {
  const existingStatus = db.prepare("SELECT id FROM statuses WHERE name = 'Email Sent'").get();
  if (!existingStatus) {
    const maxSort = db.prepare("SELECT COALESCE(MAX(sort_order), 0) m FROM statuses").get().m;
    db.prepare("INSERT INTO statuses (name, color, sort_order) VALUES ('Email Sent', 'badge-info', ?)").run(maxSort + 1);
  }
  const existingOutcome = db.prepare("SELECT id FROM outcomes WHERE label = 'Email Sent'").get();
  if (!existingOutcome) {
    const maxSortO = db.prepare("SELECT COALESCE(MAX(sort_order), 0) m FROM outcomes").get().m;
    // is_connect=0: this fires for an email send, not a live phone pickup —
    // it must never count toward "connects" (that flag drives connect-rate
    // and the MCP call-stats tool, both meant to measure human phone contact).
    db.prepare("INSERT INTO outcomes (label, status, key, is_connect, needs_followup, sort_order) VALUES ('Email Sent', 'Email Sent', 'e', 0, 0, ?)").run(maxSortO + 1);
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('dispositions_v4', '1')").run();
}

if (!db.prepare("SELECT value FROM meta WHERE key = 'dispositions_v5'").get()) {
  // Corrects a mistake from dispositions_v4: Email Sent was inserted with
  // is_connect=1, so every follow-up email quietly counted as a live phone
  // connect in connect-rate and MCP call-stats. Fixing the existing row.
  db.prepare("UPDATE outcomes SET is_connect = 0 WHERE label = 'Email Sent'").run();
  db.prepare("INSERT INTO meta (key, value) VALUES ('dispositions_v5', '1')").run();
}

// Drops Email Sent (never used enough to justify a button slot) and adds
// "NotFit" — the rep's post-dial disqualification for businesses that
// clearly aren't owner-operated (franchises, corporate switchboards, big
// staff). is_connect=0 by design: it's a judgment call, not evidence of a
// live pitch, so it must not inflate connect rate. Deleting the outcome/
// status rows only removes them from the picklist — any historical note
// or lead still carrying "Email Sent" text stays intact.
if (!db.prepare("SELECT value FROM meta WHERE key = 'dispositions_v6'").get()) {
  db.prepare("DELETE FROM outcomes WHERE label = 'Email Sent'").run();
  db.prepare("DELETE FROM statuses WHERE name = 'Email Sent'").run();

  const notFitStatus = db.prepare("SELECT id FROM statuses WHERE name = 'Not a Fit'").get();
  if (!notFitStatus) {
    const maxS = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM statuses').get().m;
    db.prepare("INSERT INTO statuses (name, color, sort_order) VALUES ('Not a Fit', 'badge-danger', ?)").run(maxS + 1);
  }
  const notFitOutcome = db.prepare("SELECT id FROM outcomes WHERE label = 'NotFit'").get();
  if (!notFitOutcome) {
    const maxO = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM outcomes').get().m;
    db.prepare("INSERT INTO outcomes (label, status, key, is_connect, needs_followup, sort_order) VALUES ('NotFit', 'Not a Fit', 'n', 0, 0, ?)").run(maxO + 1);
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('dispositions_v6', '1')").run();
}

// dispositions_v6 dropped Email Sent as unused, but it's driven by its own
// dedicated button on the lead detail page (EmailDraftPanel's "Mark as Email
// Sent"), not the Active Session quick-dispositions — that email-sending
// flow calls log-call with outcome='Email Sent' regardless of whether it's a
// choosable button anywhere, so removing the outcome row broke it outright
// (400 "invalid outcome"). Re-added here, is_connect=0 per the v5 fix above.
// It's deliberately kept OUT of the Active Session/Queue button grid — see
// the client-side filter in OutcomePanel.jsx — so this is scoped to "exists
// as a valid outcome for the lead-detail flow to log," not "is a call
// disposition a rep picks mid-session."
if (!db.prepare("SELECT value FROM meta WHERE key = 'dispositions_v7'").get()) {
  const emailStatus = db.prepare("SELECT id FROM statuses WHERE name = 'Email Sent'").get();
  if (!emailStatus) {
    const maxS = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM statuses').get().m;
    db.prepare("INSERT INTO statuses (name, color, sort_order) VALUES ('Email Sent', 'badge-info', ?)").run(maxS + 1);
  }
  const emailOutcome = db.prepare("SELECT id FROM outcomes WHERE label = 'Email Sent'").get();
  if (!emailOutcome) {
    const maxO = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM outcomes').get().m;
    db.prepare("INSERT INTO outcomes (label, status, key, is_connect, needs_followup, sort_order) VALUES ('Email Sent', 'Email Sent', 'e', 0, 0, ?)").run(maxO + 1);
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('dispositions_v7', '1')").run();
}

// Inbound artifacts: voicemails left on the Twilio number, and SMS received.
db.exec(`
CREATE TABLE IF NOT EXISTS voicemails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT NOT NULL UNIQUE,
  recording_sid TEXT,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  from_number TEXT NOT NULL DEFAULT '',
  duration_sec INTEGER,
  recording_url TEXT NOT NULL DEFAULT '',
  transcript TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sms_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT NOT NULL UNIQUE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'inbound',
  from_number TEXT NOT NULL DEFAULT '',
  to_number TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export const PRIORITIES = ['Hot', 'Warm', 'Cold'];
export const ROLES = ['Gatekeeper', 'Owner', 'AI'];
export const TARGET_METRICS = ['dials', 'conversations', 'owner_conversations'];

export function getStatuses() {
  return db.prepare('SELECT * FROM statuses ORDER BY sort_order, id').all();
}

export function getOutcomes() {
  return db.prepare('SELECT * FROM outcomes ORDER BY sort_order, id').all();
}

export function getCustomFields() {
  return db.prepare('SELECT * FROM custom_fields ORDER BY sort_order, id').all();
}
