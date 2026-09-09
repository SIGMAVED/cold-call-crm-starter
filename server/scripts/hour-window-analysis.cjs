#!/usr/bin/env node
/**
 * Which hour-of-day (in the PROSPECT's local time, not IST/ET blanket-assumed)
 * actually produces more human-interaction outcomes — using the full dial
 * dataset (2,376 dispositioned dials, not just the 447-row role-tagged subset),
 * and the same train/test repeatability check just used for owner-pattern-analysis.cjs.
 *
 * "Connect" = HUMAN_INTERACTION_DISPOSITIONS from routes/analytics.js
 * (Rejected, Follow up scheduled, Meeting Booked) — the app's own existing
 * definition of "a person, not a machine, was on the line."
 */
const path = require('node:path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '..', 'db', 'crm.sqlite'), { readonly: true });

const MIN_N = 30;
const SPLIT = '2026-07-22'; // same split point as owner-pattern-analysis.cjs

function wilson(s, n, z = 1.96) {
  if (!n) return { low: 0, high: 0 };
  const p = s / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), sp = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { low: Math.max(0, ((c - sp) / d) * 100), high: Math.min(100, ((c + sp) / d) * 100) };
}
const pct = (s, n) => (n ? Math.round((s / n) * 1000) / 10 : 0);

const HUMAN = ['Rejected', 'Follow up scheduled', 'Meeting Booked'];

// Pull every dispositioned dial with its lead's state/city so we can compute
// the PROSPECT's local hour, not IST or a blanket ET assumption.
const rows = db.prepare(`
  SELECT n.created_at, n.outcome, l.state, l.city
  FROM notes n JOIN leads l ON l.id = n.lead_id
  WHERE n.outcome IS NOT NULL
`).all();

// Reuse the exact same STATE_TZ / CITY_TZ table as timezone.js (inlined here
// since that file is ESM and this script is CJS) to convert each dial's UTC
// created_at into the prospect's local hour.
const { timezoneForLead } = requireTimezone();
function requireTimezone() {
  // Minimal re-implementation matching server/timezone.js STATE_TZ exactly.
  const STATE_TZ = {
    CA: 'America/Los_Angeles', WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', NV: 'America/Los_Angeles',
    AZ: 'America/Phoenix', CO: 'America/Denver', UT: 'America/Denver', NM: 'America/Denver',
    MT: 'America/Denver', WY: 'America/Denver', ID: 'America/Boise',
    IL: 'America/Chicago', TX: 'America/Chicago', TN: 'America/Chicago', MO: 'America/Chicago',
    LA: 'America/Chicago', AR: 'America/Chicago', OK: 'America/Chicago', KS: 'America/Chicago',
    NE: 'America/Chicago', IA: 'America/Chicago', MN: 'America/Chicago', WI: 'America/Chicago',
    MS: 'America/Chicago', AL: 'America/Chicago', ND: 'America/Chicago', SD: 'America/Chicago',
    NY: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', NC: 'America/New_York',
    SC: 'America/New_York', OH: 'America/New_York', PA: 'America/New_York', MI: 'America/New_York',
    VA: 'America/New_York', WV: 'America/New_York', MD: 'America/New_York', DE: 'America/New_York',
    NJ: 'America/New_York', CT: 'America/New_York', RI: 'America/New_York', MA: 'America/New_York',
    VT: 'America/New_York', NH: 'America/New_York', ME: 'America/New_York', KY: 'America/New_York',
    IN: 'America/New_York', HI: 'Pacific/Honolulu', AK: 'America/Anchorage',
  };
  const CITY_TZ = {
    'TX:el paso': 'America/Denver',
    'FL:pensacola': 'America/Chicago', 'FL:panama city': 'America/Chicago',
    'FL:fort walton beach': 'America/Chicago', 'FL:destin': 'America/Chicago',
    'FL:crestview': 'America/Chicago', 'FL:navarre': 'America/Chicago',
    'FL:niceville': 'America/Chicago', 'FL:gulf breeze': 'America/Chicago',
    'TN:knoxville': 'America/New_York', 'TN:chattanooga': 'America/New_York',
    'TN:johnson city': 'America/New_York', 'TN:kingsport': 'America/New_York',
    'TN:bristol': 'America/New_York', 'TN:oak ridge': 'America/New_York',
    'TN:sevierville': 'America/New_York', 'TN:gatlinburg': 'America/New_York',
  };
  function timezoneForLead(state, city) {
    const st = String(state || '').trim().toUpperCase();
    if (!st) return null;
    const key = `${st}:${String(city || '').trim().toLowerCase()}`;
    return CITY_TZ[key] || STATE_TZ[st] || null;
  }
  return { timezoneForLead };
}

const formatterCache = new Map();
function localHour(tz, utcDate) {
  if (!formatterCache.has(tz)) {
    formatterCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }));
  }
  const parts = formatterCache.get(tz).formatToParts(utcDate);
  return parseInt(parts.find((p) => p.type === 'hour').value, 10);
}

let noTz = 0;
const buckets = {}; // hour -> { train: {n,s}, test: {n,s} }
for (let h = 0; h < 24; h++) buckets[h] = { train: { n: 0, s: 0 }, test: { n: 0, s: 0 } };

for (const r of rows) {
  const tz = timezoneForLead(r.state, r.city);
  if (!tz) { noTz++; continue; }
  // created_at stored as UTC (matches convention used in metrics.js byHour block)
  const utcDate = new Date(r.created_at.includes('Z') ? r.created_at : r.created_at + 'Z');
  const hour = localHour(tz, utcDate);
  const half = r.created_at.slice(0, 10) < SPLIT ? 'train' : 'test';
  buckets[hour][half].n++;
  if (HUMAN.includes(r.outcome)) buckets[hour][half].s++;
}

console.log('='.repeat(100));
console.log(`HOUR-OF-DAY (prospect's LOCAL time) vs human-interaction rate — full dataset, n=${rows.length} dials`);
console.log(`(${noTz} dials excluded: no state → no timezone)`);
console.log('='.repeat(100));

// Baselines per half (all hours combined)
let trainTot = { n: 0, s: 0 }, testTot = { n: 0, s: 0 };
for (let h = 0; h < 24; h++) {
  trainTot.n += buckets[h].train.n; trainTot.s += buckets[h].train.s;
  testTot.n += buckets[h].test.n; testTot.s += buckets[h].test.s;
}
const trainBase = pct(trainTot.s, trainTot.n);
const testBase = pct(testTot.s, testTot.n);
console.log(`train (before ${SPLIT}): n=${trainTot.n}  connects=${trainTot.s}  rate=${trainBase}%`);
console.log(`test  (from ${SPLIT})  : n=${testTot.n}  connects=${testTot.s}  rate=${testBase}%`);

console.log('\n' + 'hour(local)'.padEnd(12), 'train(n,rate,CI)'.padEnd(28), 'test(n,rate,CI)'.padEnd(28), 'REPEATS ABOVE BASELINE?');
console.log('-'.repeat(110));

const survivors = [];
for (let h = 0; h < 24; h++) {
  const tr = buckets[h].train, te = buckets[h].test;
  const trCI = wilson(tr.s, tr.n), teCI = wilson(te.s, te.n);
  const enoughData = tr.n >= MIN_N && te.n >= MIN_N;
  const trainBeats = enoughData && trCI.low > trainBase;
  const testBeats = enoughData && teCI.low > testBase;
  const repeats = enoughData && trainBeats && testBeats;
  if (repeats) survivors.push({ hour: h, tr, te, trCI, teCI });
  console.log(
    String(h).padStart(2, '0') + ':00'.padEnd(8),
    `n=${tr.n} ${pct(tr.s, tr.n)}% [${trCI.low.toFixed(0)}-${trCI.high.toFixed(0)}]`.padEnd(28),
    `n=${te.n} ${pct(te.s, te.n)}% [${teCI.low.toFixed(0)}-${teCI.high.toFixed(0)}]`.padEnd(28),
    !enoughData ? 'thin data' : repeats ? '✅ YES' : '—'
  );
}

console.log('\n' + '='.repeat(100));
console.log(`SURVIVORS: ${survivors.length} local hour(s) that beat baseline in BOTH independent time windows`);
console.log('='.repeat(100));
if (!survivors.length) {
  console.log('  None survive at single-hour granularity with non-overlapping CI in both halves.');
} else {
  survivors.forEach((s) => console.log(`  - ${String(s.hour).padStart(2, '0')}:00 local  (train ${pct(s.tr.s, s.tr.n)}%, test ${pct(s.te.s, s.te.n)}% vs baseline ${trainBase}%/${testBase}%)`));
}

// Also check wider 2-hour blocks, which is closer to how the user actually
// schedules calling sessions, and gives each bucket more statistical power.
console.log('\n' + '='.repeat(100));
console.log('SAME TEST AT 2-HOUR BLOCK GRANULARITY (more power per bucket)');
console.log('='.repeat(100));
const blocks = {};
for (let b = 0; b < 12; b++) blocks[b] = { train: { n: 0, s: 0 }, test: { n: 0, s: 0 } };
for (let h = 0; h < 24; h++) {
  const b = Math.floor(h / 2);
  blocks[b].train.n += buckets[h].train.n; blocks[b].train.s += buckets[h].train.s;
  blocks[b].test.n += buckets[h].test.n; blocks[b].test.s += buckets[h].test.s;
}
console.log('block(local)'.padEnd(14), 'train(n,rate,CI)'.padEnd(28), 'test(n,rate,CI)'.padEnd(28), 'REPEATS ABOVE BASELINE?');
console.log('-'.repeat(110));
const blockSurvivors = [];
for (let b = 0; b < 12; b++) {
  const tr = blocks[b].train, te = blocks[b].test;
  const trCI = wilson(tr.s, tr.n), teCI = wilson(te.s, te.n);
  const enoughData = tr.n >= MIN_N && te.n >= MIN_N;
  const repeats = enoughData && trCI.low > trainBase && teCI.low > testBase;
  if (repeats) blockSurvivors.push({ block: b, tr, te });
  const label = `${String(b * 2).padStart(2, '0')}-${String(b * 2 + 2).padStart(2, '0')}h`;
  console.log(
    label.padEnd(14),
    `n=${tr.n} ${pct(tr.s, tr.n)}% [${trCI.low.toFixed(0)}-${trCI.high.toFixed(0)}]`.padEnd(28),
    `n=${te.n} ${pct(te.s, te.n)}% [${teCI.low.toFixed(0)}-${teCI.high.toFixed(0)}]`.padEnd(28),
    !enoughData ? 'thin data' : repeats ? '✅ YES' : '—'
  );
}
console.log(`\nSURVIVORS at 2-hour granularity: ${blockSurvivors.length}`);
blockSurvivors.forEach((s) => console.log(`  - ${String(s.block * 2).padStart(2, '0')}:00-${String(s.block * 2 + 2).padStart(2, '0')}:00 local  (train ${pct(s.tr.s, s.tr.n)}%, test ${pct(s.te.s, s.te.n)}%)`));

db.close();
