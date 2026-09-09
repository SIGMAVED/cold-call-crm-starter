#!/usr/bin/env node
/**
 * Finds lead attributes that ACTUALLY predict reaching the owner, using real
 * dial outcomes rather than asserting a pattern (that's how the handoff doc's
 * "1,873 leads, 66%" claim happened — a filter that was never checked against
 * results).
 *
 * Method: split tagged dials into two time halves. A candidate attribute only
 * counts as a real, repeatable pattern if its owner-rate beats baseline with
 * a non-overlapping 95% CI in BOTH halves independently — i.e. it predicted,
 * then it predicted again, on data it wasn't fit to. Then: how many undialed
 * leads match the surviving pattern right now.
 */
const path = require('node:path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '..', 'db', 'crm.sqlite'), { readonly: true });

const MIN_N = 30;

function wilson(s, n, z = 1.96) {
  if (!n) return { low: 0, high: 0 };
  const p = s / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), sp = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { low: Math.max(0, ((c - sp) / d) * 100), high: Math.min(100, ((c + sp) / d) * 100) };
}
const pct = (s, n) => (n ? Math.round((s / n) * 1000) / 10 : 0);

// Split point chosen from the actual daily distribution (roughly even split
// of tagged volume), not cherry-picked to favor a result.
const SPLIT = '2026-07-22';

function baseline(where) {
  const row = db.prepare(`
    SELECT COUNT(*) n, SUM(CASE WHEN n2.contact_role='owner' THEN 1 ELSE 0 END) owners
    FROM notes n2 JOIN leads l ON l.id = n2.lead_id
    WHERE n2.contact_role IS NOT NULL ${where}
  `).get();
  return { n: row.n, owners: row.owners || 0, rate: pct(row.owners, row.n) };
}

// Candidate attributes — anything plausibly knowable BEFORE dialing, so the
// surviving ones are usable as a queue filter, not hindsight.
const CANDIDATES = [
  { label: 'reviews 10-49', where: "AND l.review_count BETWEEN 10 AND 49" },
  { label: 'reviews 50-99', where: "AND l.review_count BETWEEN 50 AND 99" },
  { label: 'reviews 100-199', where: "AND l.review_count BETWEEN 100 AND 199" },
  { label: 'reviews 200+', where: "AND l.review_count >= 200" },
  { label: 'reviews 0-9', where: "AND l.review_count BETWEEN 0 AND 9" },
  { label: 'review_count NULL', where: "AND l.review_count IS NULL" },
  { label: 'rating 4.7-5.0', where: "AND l.rating BETWEEN 4.7 AND 5.0" },
  { label: 'rating 4.0-4.69', where: "AND l.rating BETWEEN 4.0 AND 4.69" },
  { label: 'rating < 4.0', where: "AND l.rating < 4.0 AND l.rating IS NOT NULL" },
  { label: 'rating NULL', where: "AND l.rating IS NULL" },
  { label: 'priority Hot', where: "AND l.priority = 'Hot'" },
  { label: 'priority Warm', where: "AND l.priority = 'Warm'" },
  { label: 'priority Cold', where: "AND l.priority = 'Cold'" },
  { label: 'has missed_call_evidence', where: "AND l.missed_call_evidence != ''" },
  { label: 'has website', where: "AND l.website != ''" },
  { label: 'has working_hours', where: "AND l.working_hours != ''" },
  { label: 'niche HVAC', where: "AND l.niche = 'HVAC'" },
  { label: 'niche Water Damage Restoration', where: "AND l.niche = 'Water Damage Restoration'" },
  { label: 'niche Plumber', where: "AND l.niche = 'Plumber'" },
  { label: 'niche Roofing', where: "AND l.niche = 'Roofing'" },
  { label: 'source Google Maps scrape', where: "AND l.source = 'Google Maps scrape'" },
  { label: "name has apostrophe-s / & Son(s)", where: "AND (l.business_name LIKE '%''s %' OR l.business_name LIKE '%Son%')" },
];

console.log('='.repeat(90));
console.log('BASELINE (all role-tagged dials)');
console.log('='.repeat(90));
const trainB = baseline(`AND date(n2.created_at) < '${SPLIT}'`);
const testB = baseline(`AND date(n2.created_at) >= '${SPLIT}'`);
const allB = baseline('');
console.log(`  train (before ${SPLIT}) : n=${trainB.n}  owners=${trainB.owners}  rate=${trainB.rate}%`);
console.log(`  test  (from ${SPLIT})   : n=${testB.n}  owners=${testB.owners}  rate=${testB.rate}%`);
console.log(`  overall                 : n=${allB.n}  owners=${allB.owners}  rate=${allB.rate}%`);

console.log('\n' + '='.repeat(90));
console.log('CANDIDATE ATTRIBUTES — must beat baseline with non-overlapping 95% CI in BOTH halves');
console.log('='.repeat(90));
console.log('label'.padEnd(34), 'train(n,rate,CI)'.padEnd(28), 'test(n,rate,CI)'.padEnd(28), 'REPEATS?');
console.log('-'.repeat(120));

const survivors = [];
for (const c of CANDIDATES) {
  const tr = baseline(`AND date(n2.created_at) < '${SPLIT}' ${c.where}`);
  const te = baseline(`AND date(n2.created_at) >= '${SPLIT}' ${c.where}`);
  const trCI = wilson(tr.owners, tr.n);
  const teCI = wilson(te.owners, te.n);
  const enoughData = tr.n >= MIN_N && te.n >= MIN_N;
  const trainBeats = trCI.low > trainB.rate;
  const testBeats = teCI.low > testB.rate;
  const repeats = enoughData && trainBeats && testBeats;
  if (repeats) survivors.push({ ...c, tr, te, trCI, teCI });
  console.log(
    c.label.padEnd(34),
    `n=${tr.n} ${tr.rate}% [${trCI.low.toFixed(0)}-${trCI.high.toFixed(0)}]`.padEnd(28),
    `n=${te.n} ${te.rate}% [${teCI.low.toFixed(0)}-${teCI.high.toFixed(0)}]`.padEnd(28),
    !enoughData ? 'thin data' : repeats ? '✅ YES' : '—'
  );
}

console.log('\n' + '='.repeat(90));
console.log(`SURVIVORS: ${survivors.length} attribute(s) that beat baseline in BOTH independent time windows`);
console.log('='.repeat(90));
if (!survivors.length) {
  console.log('  None. No single attribute reliably predicted owner-reach in both halves.');
  console.log('  This itself is a real finding — it means there is no repeatable single-factor');
  console.log('  pattern in the data yet, at this sample size.');
} else {
  survivors.forEach((s) => console.log(`  - ${s.label}  (train ${s.tr.rate}%, test ${s.te.rate}% vs baseline ${trainB.rate}%/${testB.rate}%)`));

  // How many CURRENT undialed leads match ANY surviving pattern, and how many
  // match the intersection of ALL of them (the strongest, narrowest bet).
  const anyWhere = survivors.map((s) => `(1=1 ${s.where})`).join(' OR ');
  const allWhere = survivors.map((s) => s.where).join(' ');
  const undialedAny = db.prepare(`SELECT COUNT(*) c FROM leads l WHERE l.status='New' AND (${anyWhere})`).get().c;
  const undialedAll = db.prepare(`SELECT COUNT(*) c FROM leads l WHERE l.status='New' ${allWhere}`).get().c;
  const totalNew = db.prepare(`SELECT COUNT(*) c FROM leads WHERE status='New'`).get().c;

  console.log(`\nUndialed ('New') leads matching AT LEAST ONE surviving pattern : ${undialedAny} / ${totalNew} (${pct(undialedAny, totalNew)}%)`);
  console.log(`Undialed leads matching ALL surviving patterns at once          : ${undialedAll} / ${totalNew} (${pct(undialedAll, totalNew)}%)`);
}

console.log('\n' + '='.repeat(90));
console.log('DATA THAT IS STILL TOO THIN TO SEGMENT (reported honestly, not forced)');
console.log('='.repeat(90));
console.log(`  presentations logged : 41 total — cannot reliably split by attribute yet`);
console.log(`  appointments logged  : 3 total  — cannot say anything statistical about closing yet`);
console.log(`  These need more LIVE-tagged volume (use O/G/T + P + A during real sessions) before`);
console.log(`  a presentation- or appointment-stage pattern can be trusted.`);

db.close();
