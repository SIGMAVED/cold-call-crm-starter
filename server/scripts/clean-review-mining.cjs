#!/usr/bin/env node
/**
 * Cleans review_mining_results.csv: keeps only rows where at least one
 * candidate name survives junk-filtering, strips generic trade/service
 * words the pattern-match heuristic mistook for names, and flags multi-
 * candidate rows for a human glance rather than silently picking one.
 *
 * Doesn't touch the CRM DB — there's no matching lead list with phone
 * numbers yet, so this just produces a clean, ready-to-merge file for
 * whenever that exists. Output columns add owner_name_source='review' and
 * a `candidate` column (the best surviving name, or blank if none did).
 */
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('csv-parse/sync');

// Minimal CSV writer — avoids adding csv-stringify as a dependency for one
// script. Quotes any field containing a comma, quote, or newline; doubles
// embedded quotes, matching RFC 4180 (the same rule csv-parse expects on read).
function toCsv(rows) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => esc(row[h])).join(','));
  return lines.join('\n') + '\n';
}

const SRC = path.join(__dirname, '..', '..', '..', 'review_mining_results.csv');
const OUT_CLEAN = path.join(__dirname, '..', '..', '..', 'review_mining_results_cleaned.csv');
const OUT_JUNK = path.join(__dirname, '..', '..', '..', 'review_mining_results_rejected.csv');

// Generic trade/service words the "name right before/after a verb" heuristic
// mistakes for a first name (e.g. "Conditioning was great", "the Crew did").
// Not an exhaustive dictionary — a targeted list of what's actually shown up.
const JUNK_WORDS = new Set([
  'install', 'installer', 'installers', 'installation', 'technician', 'technicians',
  'tech', 'techs', 'crew', 'team', 'staff', 'office', 'service', 'services',
  'repair', 'repairs', 'conditioning', 'air', 'heating', 'cooling', 'electrical',
  'company', 'guy', 'guys', 'man', 'men', 'lady', 'ladies', 'owner', 'manager',
  'plumber', 'plumbers', 'plumbing', 'hvac', 'ac', 'unit', 'system', 'systems',
]);

function isJunk(name) {
  return JUNK_WORDS.has(name.trim().toLowerCase());
}

const OUT_DUPES = path.join(__dirname, '..', '..', '..', 'review_mining_results_duplicate_listings.csv');

const raw = fs.readFileSync(SRC, 'utf8');
const rows = parse(raw, { columns: true, skip_empty_lines: true });

const candidateRows = rows.filter((r) => r.status === 'candidates_found');

// Same place_id under different business_name spellings/aliases means the
// scrape hit the same physical Google listing more than once — keeping both
// would risk two "different" leads (and two owner-name guesses) for one
// real business. Which name variant is "correct" isn't obvious from this
// data alone, so these are pulled out for a manual look rather than guessed.
const byPlaceId = new Map();
for (const row of candidateRows) {
  if (!row.place_id) continue;
  (byPlaceId.get(row.place_id) ?? byPlaceId.set(row.place_id, []).get(row.place_id)).push(row);
}
const dupePlaceIds = new Set([...byPlaceId.entries()].filter(([, list]) => list.length > 1).map(([id]) => id));

const cleaned = [];
const rejected = [];
const duplicates = [];

for (const row of candidateRows) {
  const rawNames = (row.review_mentioned_names || '').split(';').map((n) => n.trim()).filter(Boolean);
  const validNames = rawNames.filter((n) => !isJunk(n));
  const junkNames = rawNames.filter((n) => isJunk(n));

  const out = {
    business_name: row.business_name,
    address: row.address,
    place_id: row.place_id,
    candidate: validNames[0] || '',
    other_candidates: validNames.slice(1).join('; '),
    rejected_candidates: junkNames.join('; '),
    best_snippet: row.best_snippet,
    owner_name_source: 'review', // per the confidence-tier field just added to the schema
  };

  if (dupePlaceIds.has(row.place_id)) { duplicates.push(out); continue; }
  if (validNames.length > 0) cleaned.push(out);
  else rejected.push(out);
}

fs.writeFileSync(OUT_CLEAN, toCsv(cleaned));
fs.writeFileSync(OUT_JUNK, toCsv(rejected));
fs.writeFileSync(OUT_DUPES, toCsv(duplicates));

console.log(`Parsed ${rows.length} total rows.`);
console.log(`  candidates_found rows: ${candidateRows.length} (${byPlaceId.size} unique place_ids)`);
console.log(`  -> kept (has a valid name): ${cleaned.length}  -> ${OUT_CLEAN}`);
console.log(`  -> rejected (every candidate was junk): ${rejected.length}  -> ${OUT_JUNK}`);
console.log(`  -> set aside (place_id scraped under 2+ business names): ${duplicates.length}  -> ${OUT_DUPES}`);
if (rejected.length) {
  console.log('\nRejected rows (every candidate on the row was a junk word):');
  for (const r of rejected) console.log(`  - ${r.business_name}: [${r.rejected_candidates}]`);
}
const multi = cleaned.filter((c) => c.other_candidates);
if (multi.length) {
  console.log(`\n${multi.length} rows had more than one valid candidate — "candidate" is a guess (first-listed), worth a manual glance:`);
  for (const m of multi) console.log(`  - ${m.business_name}: picked "${m.candidate}", also saw [${m.other_candidates}]`);
}
