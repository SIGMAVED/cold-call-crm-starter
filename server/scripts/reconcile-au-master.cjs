#!/usr/bin/env node
/**
 * Reconciles au_leads_master.csv against whatever's already in the CRM as
 * country=AU. Re-run-safe: matches by phone_normalized, so running this
 * again after the file grows only processes the delta sensibly.
 *
 * For phone matches already in the CRM: upgrades owner_name/owner_name_source
 * only when the master's tier is strictly better (never downgrades a
 * verified/higher-confidence name to a lower one), and fills in website/
 * entity_type/city/state wherever they're currently blank — this version of
 * the file added city/state (98.7% populated) where the first pass had none
 * at all, so this also backfills that gap onto the 338 leads imported before
 * this field existed. For rows with no match, creates a new lead.
 *
 * Dry-run by default; --apply commits.
 */
const path = require('node:path');
const fs = require('node:fs');
const { parse } = require('csv-parse/sync');
const Database = require('better-sqlite3');

const APPLY = process.argv.includes('--apply');
const SRC = path.join(__dirname, '..', '..', '..', 'au_leads_master.csv');
const db = new Database(path.join(__dirname, '..', 'db', 'crm.sqlite'));

function normalizePhoneAU(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('61')) digits = digits.slice(2);
  else if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

// Maps this file's free-text owner_source into the CRM's owner_name_source
// enum, and ranks tiers so an update only ever moves a lead's confidence up.
const SOURCE_MAP = { 'ABN Lookup': 'abn_registry', 'Firecrawl website crawl': 'website', 'Google review mention': 'review' };
const RANK = { null: 0, review: 1, website: 2, abn_registry: 2, verified: 3 };

// Same list as clean-review-mining.cjs, plus 'communication' — found while
// reconciling: two leads from the first import already have owner_name
// literally set to "Communication", a false positive the original blocklist
// missed. Applying this list to BOTH sides of the comparison below fixes
// those retroactively, since a junk current value no longer blocks a real
// correction from landing.
const JUNK_WORDS = new Set([
  'install', 'installer', 'installers', 'installation', 'technician', 'technicians',
  'tech', 'techs', 'crew', 'team', 'staff', 'office', 'service', 'services',
  'repair', 'repairs', 'conditioning', 'air', 'heating', 'cooling', 'electrical',
  'company', 'guy', 'guys', 'man', 'men', 'lady', 'ladies', 'owner', 'manager',
  'plumber', 'plumbers', 'plumbing', 'hvac', 'ac', 'unit', 'system', 'systems',
  'communication', 'communications',
]);
const isJunk = (name) => JUNK_WORDS.has(name.trim().toLowerCase());
function bestCandidate(rawList) {
  return (rawList || '').split(';').map((n) => n.trim()).filter((n) => n && !isJunk(n))[0] || '';
}

// This version of the file spans 6 trades, not just HVAC — its own
// `category` column is Google's auto-classification and is unreliable (e.g.
// "Coles Refrigeration & Air Conditioning" tagged 'manufacturer', "Ford &
// Doonan Air Conditioning" tagged 'store', several real HVAC businesses
// tagged 'car_repair' because Google's classifier choked on "Auto Air"
// naming). business_name is the trustworthy signal instead. Returns null for
// a name that's confidently a different trade entirely (off-niche —
// automotive/painting/flooring), or 'UNCLASSIFIED' when nothing matches —
// both get skipped rather than guessed at.
function classifyNiche(name) {
  const n = (name || '').toLowerCase();
  if (/plumb|\bdrain|\bsewer|\btap doctor|toilets? and drains/.test(n)) return 'Plumber';
  if (/electric|electrik|sparkie|spark|\bvolt|powellect/.test(n)) return 'Electrical';
  if (/roof|guttering/.test(n)) return 'Roofing';
  if (/restoration|water damage|flood|fire damage|mould|mold remediation|remediation|steamatic/.test(n)) return 'Water Damage Restoration';
  if (/\bpest|termite/.test(n)) return 'Pest Control';
  if (/air|hvac|cool|chill|therm|frig|\bduct|evaporative|mechanical|heat/.test(n) || /\bac\b/.test(n)) return 'HVAC';
  if (/general contract|\bbuilder|construction|renovation|demolition/.test(n)) return 'General Contractor';
  if (/\bauto\b|car repair|automotive|carpenter|\bpaint|polish|carpet|floor|plaster|colou?r/.test(n)) return null;
  return 'UNCLASSIFIED';
}

const rows = parse(fs.readFileSync(SRC, 'utf8'), { columns: true, skip_empty_lines: true });

const selectByPhone = db.prepare("SELECT * FROM leads WHERE phone_normalized = ?");
const updateStmt = db.prepare(`
  UPDATE leads SET owner_name = @owner_name, owner_name_source = @owner_name_source,
    website = COALESCE(NULLIF(website, ''), @website), entity_type = COALESCE(entity_type, @entity_type),
    city = COALESCE(NULLIF(city, ''), @city), state = COALESCE(NULLIF(state, ''), @state)
  WHERE id = @id
`);
const fillOnlyStmt = db.prepare(`
  UPDATE leads SET website = COALESCE(NULLIF(website, ''), @website), entity_type = COALESCE(entity_type, @entity_type),
    city = COALESCE(NULLIF(city, ''), @city), state = COALESCE(NULLIF(state, ''), @state)
  WHERE id = @id
`);
const insertStmt = db.prepare(`
  INSERT INTO leads (
    business_name, contact_name, owner_name, phone, phone_normalized, phone_2, email,
    website, google_maps_url, working_hours, address, city, state, niche, source,
    status, priority, next_followup_date, review_count, rating, lead_score,
    missed_call_evidence, country, website_quality, owner_name_source, entity_type
  ) VALUES (
    @business_name, '', @owner_name, @phone, @phone_normalized, '', '',
    @website, '', '', @address, @city, @state, @niche, @source,
    'New', 'Warm', NULL, NULL, NULL, NULL,
    '', 'AU', NULL, @owner_name_source, @entity_type
  )
`);

let upgraded = 0, filledOnly = 0, unchangedMatch = 0, tieConflict = 0, created = 0, skippedNoPhone = 0;
let skippedOffNiche = 0, skippedUnclassified = 0;
const tieLog = [];
const unclassifiedLog = [];
const createdByNiche = {};
const seenThisRun = new Map(); // phone_normalized -> row, so within-file dupes in the master don't create two new leads

const tx = db.transaction(() => {
  for (const row of rows) {
    const phone_normalized = normalizePhoneAU(row.phone);
    if (!phone_normalized) { skippedNoPhone++; continue; }

    const newSource = SOURCE_MAP[row.owner_source] || null;
    // Master's owner_name is a raw, sometimes multi-candidate field (e.g.
    // "Install; Rafael; Sam") for the review-mention rows, same shape as the
    // original review_mining_results.csv — clean it the same way.
    const newOwner = row.owner_source === 'Google review mention' ? bestCandidate(row.owner_name) : (row.owner_name || '').trim();
    const website = (row.website || '').trim();
    const entity_type = (row.entity_type || '').trim() || null;
    const address = /^\s*·\s*\S/.test(row.address || '') ? row.address.replace(/^\s*·\s*/, '').trim() : '';
    const city = (row.city || '').trim();
    const state = (row.state || '').trim();

    const existing = selectByPhone.get(phone_normalized);
    if (existing) {
      // A junk current value (e.g. "Communication" from the first import's
      // gap) shouldn't outrank a real correction just because they're
      // nominally the same tier — treat it as if nothing was ever recorded.
      const currentIsJunk = existing.owner_name && isJunk(existing.owner_name);
      const currentRank = currentIsJunk ? 0 : (RANK[existing.owner_name_source] ?? 0);
      const newRank = RANK[newSource] ?? 0;
      if (newOwner && (newRank > currentRank || (currentIsJunk && newRank >= 0))) {
        if (APPLY) updateStmt.run({ id: existing.id, owner_name: newOwner, owner_name_source: newSource, website, entity_type, city, state });
        upgraded++;
      } else if (newRank === currentRank && newRank > 0 && newOwner && newOwner !== existing.owner_name) {
        tieConflict++;
        tieLog.push(`${existing.business_name}: DB has "${existing.owner_name}" (${existing.owner_name_source}), master also has "${newOwner}" (${newSource}) — kept DB value, left for manual check`);
        if (APPLY) fillOnlyStmt.run({ id: existing.id, website, entity_type, city, state });
      } else {
        unchangedMatch++;
        if (APPLY) fillOnlyStmt.run({ id: existing.id, website, entity_type, city, state });
      }
      continue;
    }

    // Not confidently a target trade (or confidently a different one
    // entirely) — skip rather than mislabel. This file spans 6 trades now,
    // not just HVAC, and its own category column isn't trustworthy (see
    // classifyNiche's comment).
    const niche = classifyNiche(row.business_name);
    if (niche === null) { skippedOffNiche++; continue; }
    if (niche === 'UNCLASSIFIED') { skippedUnclassified++; unclassifiedLog.push(row.business_name); continue; }

    // Not in the DB yet — new lead, unless another row earlier in this same
    // file already claimed this phone number.
    if (seenThisRun.has(phone_normalized)) continue;
    seenThisRun.set(phone_normalized, row);

    if (APPLY) {
      insertStmt.run({
        business_name: row.business_name || '',
        owner_name: newOwner,
        phone: row.phone,
        phone_normalized,
        website,
        address,
        city,
        state,
        niche,
        source: 'AU lead master list (Google Maps + ABN + Firecrawl + reviews)',
        owner_name_source: newOwner ? newSource : null,
        entity_type,
      });
    }
    created++;
    createdByNiche[niche] = (createdByNiche[niche] || 0) + 1;
  }
});
tx();

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — au_leads_master.csv reconciliation`);
console.log(`  total rows in master: ${rows.length}`);
console.log(`  matched existing leads, upgraded owner confidence: ${upgraded}`);
console.log(`  matched existing leads, no change needed: ${unchangedMatch}`);
console.log(`  matched existing leads, same-tier NAME CONFLICT (kept DB value): ${tieConflict}`);
console.log(`  new leads created: ${created}`);
console.table(createdByNiche);
console.log(`  skipped, no parseable phone: ${skippedNoPhone}`);
console.log(`  skipped, confidently a different trade (off-niche): ${skippedOffNiche}`);
console.log(`  skipped, name doesn't confidently indicate a trade: ${skippedUnclassified}`);
if (tieLog.length) { console.log('\nSame-tier conflicts (worth a manual look):'); tieLog.forEach((t) => console.log('  -', t)); }
if (unclassifiedLog.length) {
  const outPath = path.join(__dirname, '..', '..', '..', 'au_master_unclassified_names.txt');
  fs.writeFileSync(outPath, unclassifiedLog.join('\n') + '\n');
  console.log(`\n${unclassifiedLog.length} skipped names written to ${outPath} in case any are worth manually assigning a niche.`);
}
if (!APPLY) console.log('\nRe-run with --apply to actually write these changes.');

db.close();
