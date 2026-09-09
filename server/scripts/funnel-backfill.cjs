#!/usr/bin/env node
/**
 * Adds the funnel-metric columns to `notes` and backfills what can be inferred
 * from existing history, so the new dashboard opens with a baseline instead of
 * an empty chart.
 *
 *   node scripts/funnel-backfill.cjs            # DRY RUN — prints SQL + counts
 *   node scripts/funnel-backfill.cjs --apply    # actually writes
 *
 * Backfilled rows are tagged metrics_source='backfill' so inferred data is
 * always distinguishable from data typed live during a call, and nothing
 * already marked 'live' is ever overwritten.
 */
const path = require('node:path');
const Database = require('better-sqlite3');

const APPLY = process.argv.includes('--apply');
const DB_PATH = path.join(__dirname, '..', 'db', 'crm.sqlite');

// The phrases that constitute "made an explicit ask". Deliberately narrow: a
// friendly chat with no ask is NOT a presentation.
const ASK_RE = /would you be open|quick demo|see how it works|fifteen minutes|15 minutes|hop on a call|set up a time|calendar|text you a number|try it|call it right now|sixty seconds|show you what it sounds|jump on|schedule/i;

const MIGRATION = [
  ["ALTER TABLE notes ADD COLUMN contact_role TEXT", 'contact_role'],
  ["ALTER TABLE notes ADD COLUMN presented INTEGER", 'presented'],
  ["ALTER TABLE notes ADD COLUMN appointment_set INTEGER", 'appointment_set'],
  ["ALTER TABLE notes ADD COLUMN metrics_source TEXT", 'metrics_source'],
];
const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_notes_contact_role ON notes(contact_role)',
  'CREATE INDEX IF NOT EXISTS idx_notes_presented ON notes(presented)',
];

const db = new Database(DB_PATH, { readonly: !APPLY });
const cols = db.prepare('PRAGMA table_info(notes)').all().map((c) => c.name);

console.log('='.repeat(74));
console.log(APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written');
console.log('='.repeat(74));

console.log('\n--- MIGRATION SQL ---');
const pending = MIGRATION.filter(([, name]) => !cols.includes(name));
if (!pending.length) console.log('  (all columns already exist)');
pending.forEach(([sql]) => console.log('  ' + sql + ';'));
INDEXES.forEach((sql) => console.log('  ' + sql + ';'));

if (APPLY && pending.length) {
  pending.forEach(([sql]) => db.exec(sql));
  INDEXES.forEach((sql) => db.exec(sql));
  console.log('\n  applied.');
}

// After a dry run the columns may not exist yet, so the backfill preview has to
// compute its counts without reading them.
const haveCols = APPLY || pending.length === 0;

console.log('\n--- BACKFILL PREVIEW ---');

// 1. contact_role <- leads.role (only for notes that are actual dispositions)
const roleRows = db.prepare(`
  SELECT COUNT(*) c FROM notes n JOIN leads l ON l.id = n.lead_id
  WHERE n.outcome IS NOT NULL AND l.role IS NOT NULL AND l.role != ''
  ${haveCols ? 'AND n.contact_role IS NULL' : ''}
`).get().c;
const roleBreak = db.prepare(`
  SELECT LOWER(l.role) role, COUNT(*) c FROM notes n JOIN leads l ON l.id = n.lead_id
  WHERE n.outcome IS NOT NULL AND l.role IS NOT NULL AND l.role != ''
  ${haveCols ? 'AND n.contact_role IS NULL' : ''}
  GROUP BY LOWER(l.role)
`).all();
console.log(`  1. contact_role <- leads.role : ${roleRows} note rows`);
roleBreak.forEach((r) => console.log(`       ${r.role.padEnd(12)} ${r.c}`));
console.log('       NOTE: leads.role is the LATEST person reached, applied to every');
console.log('       disposition on that lead — so multi-call leads get it on all rows.');

// 2. presented <- transcript regex, calls >=25s with >1 Prospect: turn
const cands = db.prepare(`
  SELECT t.text, c.lead_id, c.started_at, c.duration_sec
  FROM transcripts t JOIN calls c ON c.id = t.call_id
  WHERE c.duration_sec >= 25 AND c.lead_id IS NOT NULL
`).all();
const asked = cands.filter((r) => {
  const turns = (String(r.text).match(/Prospect:/g) || []).length;
  return turns > 1 && ASK_RE.test(r.text);
});
console.log(`\n  2. presented <- transcript ask-detection`);
console.log(`       transcripts on calls >=25s      : ${cands.length}`);
console.log(`       ...with >1 Prospect turn + ask  : ${asked.length}  <- would set presented=1`);

// Which of those reached an owner (the number that actually matters)
const ownerLeads = new Set(db.prepare("SELECT id FROM leads WHERE role='Owner'").all().map((r) => r.id));
console.log(`       ...of those, to an Owner lead   : ${asked.filter((r) => ownerLeads.has(r.lead_id)).length}`);

// 3. appointment_set <- Meeting Booked
const appts = db.prepare(`
  SELECT COUNT(*) c FROM notes WHERE outcome = 'Meeting Booked'
  ${haveCols ? 'AND appointment_set IS NULL' : ''}
`).get().c;
console.log(`\n  3. appointment_set <- outcome='Meeting Booked' : ${appts} rows`);

if (APPLY) {
  console.log('\n--- WRITING ---');
  const tx = db.transaction(() => {
    const r1 = db.prepare(`
      UPDATE notes SET contact_role = (
        SELECT LOWER(l.role) FROM leads l WHERE l.id = notes.lead_id
      ), metrics_source = COALESCE(metrics_source, 'backfill')
      WHERE outcome IS NOT NULL AND contact_role IS NULL
        AND EXISTS (SELECT 1 FROM leads l WHERE l.id = notes.lead_id AND l.role IS NOT NULL AND l.role != '')
    `).run();
    console.log('  contact_role rows updated   :', r1.changes);

    // Match each qualifying transcript to the disposition note closest in time
    // on the same lead — notes and calls aren't linked by a foreign key.
    const pick = db.prepare(`
      SELECT id FROM notes
      WHERE lead_id = ? AND outcome IS NOT NULL AND presented IS NULL
      ORDER BY ABS(strftime('%s', created_at) - strftime('%s', ?)) LIMIT 1
    `);
    const setPresented = db.prepare(
      "UPDATE notes SET presented = 1, metrics_source = COALESCE(metrics_source,'backfill') WHERE id = ?"
    );
    let p = 0;
    for (const row of asked) {
      const hit = pick.get(row.lead_id, row.started_at);
      if (hit) p += setPresented.run(hit.id).changes;
    }
    console.log('  presented=1 rows set        :', p);

    const r3 = db.prepare(`
      UPDATE notes SET appointment_set = 1, metrics_source = COALESCE(metrics_source,'backfill')
      WHERE outcome = 'Meeting Booked' AND appointment_set IS NULL
    `).run();
    console.log('  appointment_set=1 rows set  :', r3.changes);
  });
  tx();

  console.log('\n--- VERIFY ---');
  const v = db.prepare(`SELECT
      SUM(CASE WHEN contact_role IS NOT NULL THEN 1 ELSE 0 END) roles,
      SUM(CASE WHEN presented = 1 THEN 1 ELSE 0 END) presented,
      SUM(CASE WHEN appointment_set = 1 THEN 1 ELSE 0 END) appts,
      SUM(CASE WHEN metrics_source = 'backfill' THEN 1 ELSE 0 END) backfilled,
      COUNT(*) total
    FROM notes`).get();
  console.log('  ', JSON.stringify(v));
} else {
  console.log('\nRe-run with --apply to write these changes.');
}
db.close();
