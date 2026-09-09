#!/usr/bin/env node
/**
 * One-off import: review_mining_results.csv -> leads (country=AU).
 *
 * Scope (per user decision): every row except place_not_found/no_reviews —
 * a business without a phone we can dial isn't worth a row, but a business
 * with a phone and no review-mined owner name still is, same as existing US
 * leads with blank owner_name.
 *
 * city/state are left blank on purpose (per user decision) — the source
 * data has no reliable suburb/state anywhere (82/248 rows don't even have a
 * real address, just a Google category placeholder), so guessing would be
 * worse than an honest blank. This means "callable now"/local-time won't
 * work for this batch until it's enriched separately.
 *
 * place_id is NOT used for dedup — checked directly against the data and
 * found 15 of 17 shared-place_id groups have DIFFERENT phone numbers per
 * business-name variant (one place_id mapped to 9 distinct Brisbane
 * businesses), meaning the scrape's place_id resolution is unreliable for a
 * meaningful chunk of rows. phone_normalized is the only trustworthy dedupe
 * key here, same as the rest of this CRM.
 *
 * Dry-run by default; --apply commits.
 */
const path = require('node:path');
const fs = require('node:fs');
const { parse } = require('csv-parse/sync');
const Database = require('better-sqlite3');

const APPLY = process.argv.includes('--apply');
const SRC = path.join(__dirname, '..', '..', '..', 'review_mining_results.csv');
const db = new Database(path.join(__dirname, '..', 'db', 'crm.sqlite'));

// Mirrors phone.js's AU branch — kept local so this script has no import-path
// dependency on the ESM server code (this is a CJS script, like the other
// one-off scripts in this folder).
function normalizePhoneAU(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('61')) digits = digits.slice(2);
  else if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

const JUNK_WORDS = new Set([
  'install', 'installer', 'installers', 'installation', 'technician', 'technicians',
  'tech', 'techs', 'crew', 'team', 'staff', 'office', 'service', 'services',
  'repair', 'repairs', 'conditioning', 'air', 'heating', 'cooling', 'electrical',
  'company', 'guy', 'guys', 'man', 'men', 'lady', 'ladies', 'owner', 'manager',
  'plumber', 'plumbers', 'plumbing', 'hvac', 'ac', 'unit', 'system', 'systems',
]);
const isJunk = (name) => JUNK_WORDS.has(name.trim().toLowerCase());

const rows = parse(fs.readFileSync(SRC, 'utf8'), { columns: true, skip_empty_lines: true });
const importable = rows.filter((r) => r.status === 'candidates_found' || r.status === 'no_candidates');

const insertStmt = db.prepare(`
  INSERT INTO leads (
    business_name, contact_name, owner_name, phone, phone_normalized, phone_2, email,
    website, google_maps_url, working_hours, address, city, state, niche, source,
    status, priority, next_followup_date, review_count, rating, lead_score,
    missed_call_evidence, country, website_quality, owner_name_source
  ) VALUES (
    @business_name, '', @owner_name, @phone, @phone_normalized, '', '',
    '', '', '', @address, '', '', @niche, @source,
    'New', 'Warm', NULL, NULL, NULL, NULL,
    '', 'AU', NULL, @owner_name_source
  )
`);

const seenPhones = new Set(
  db.prepare("SELECT phone_normalized FROM leads WHERE phone_normalized != ''").all().map((r) => r.phone_normalized)
);

let inserted = 0, skippedDupe = 0, skippedNoPhone = 0, withOwner = 0;
const dupeLog = [];

const tx = db.transaction(() => {
  for (const row of importable) {
    const phone_normalized = normalizePhoneAU(row.phone);
    if (!phone_normalized) { skippedNoPhone++; continue; }
    if (seenPhones.has(phone_normalized)) { skippedDupe++; dupeLog.push(`${row.business_name} (${row.phone})`); continue; }
    seenPhones.add(phone_normalized);

    let owner_name = '';
    let owner_name_source = null;
    if (row.status === 'candidates_found') {
      const validNames = (row.review_mentioned_names || '').split(';').map((n) => n.trim()).filter((n) => n && !isJunk(n));
      if (validNames.length > 0) {
        owner_name = validNames[0];
        owner_name_source = 'review';
        withOwner++;
      }
    }

    const address = /^\s*·\s*\S/.test(row.address || '') ? row.address.replace(/^\s*·\s*/, '').trim() : '';

    if (APPLY) {
      insertStmt.run({
        business_name: row.business_name || '',
        owner_name,
        phone: row.phone,
        phone_normalized,
        address,
        niche: 'HVAC',
        source: 'AU HVAC review-mining scrape',
        owner_name_source,
      });
    }
    inserted++;
  }
});
tx();

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — review_mining_results.csv -> leads (country=AU)`);
console.log(`  importable rows (candidates_found + no_candidates): ${importable.length}`);
console.log(`  -> would insert / inserted: ${inserted}`);
console.log(`     of which have an owner_name (review-mined): ${withOwner}`);
console.log(`  -> skipped, no parseable phone: ${skippedNoPhone}`);
console.log(`  -> skipped, phone already exists in DB (dupe): ${skippedDupe}`);
if (dupeLog.length) { console.log('  dupe details:'); dupeLog.forEach((d) => console.log('    -', d)); }
if (!APPLY) console.log('\nRe-run with --apply to actually write these rows.');

db.close();
