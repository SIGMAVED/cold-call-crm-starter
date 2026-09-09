#!/usr/bin/env node
/**
 * Step 1 gate: does Twilio Lookup actually predict the call outcomes we already
 * observed? Runs Lookup v2 (Line Type Intelligence) against a stratified sample
 * of ALREADY-DIALED leads and scores it against known dispositions.
 *
 * READ-ONLY against crm.sqlite. Writes nothing back to the leads table — results
 * land in a JSON sidecar so the run is resumable and re-scorable without
 * re-spending on lookups.
 *
 *   node scripts/lookup-backtest.cjs --sample 200
 *   node scripts/lookup-backtest.cjs --report-only   # re-score cached results
 */
const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const Database = require('better-sqlite3');
const twilio = require('twilio');

const DB_PATH = path.join(__dirname, '..', 'db', 'crm.sqlite');
const OUT_DIR = path.join(__dirname, '..', 'db', 'backtest');
const SAMPLE_FILE = path.join(OUT_DIR, 'sample.json');
const RESULTS_FILE = path.join(OUT_DIR, 'results.json');

// ---------------------------------------------------------------------------
// Ground truth
// ---------------------------------------------------------------------------
// Reaching voicemail, an IVR, a hotline or an answering service PROVES the
// number connects — those leads can never count as "dead" even if a later
// attempt was logged as "Couldn't Connect". Without this exclusion the dead
// pool gets contaminated with live numbers and the catch rate is meaningless.
const PROOF_OF_LIFE = [
  'Rejected', 'Follow up scheduled', 'Meeting Booked',
  'Ring to Voicemail', 'Direct Voicemail', 'Direct to Voicemail', 'Voicemail',
  'Hotline', 'IVR / Phone Tree', 'IVR', 'Answering Service / Dispatch', 'AI',
  'Immediate Hangup', 'Connected - Pitched (No)', 'Connected - Follow Up',
  'Gatekeeper - Blocked', 'Gatekeeper', 'Not Interested', 'No Answer',
];
const HUMAN = ['Rejected', 'Follow up scheduled', 'Meeting Booked'];
// "Bad Data / Wrong Number" is an explicit dead-number call. Kept separate from
// the ambiguous bucket below because a busy signal is not the same claim.
const DEAD_STRONG = ['Bad Data / Wrong Number', 'Junk Data (Bad/Disconnected Number)'];
// "Couldn't Connect / Busy" conflates "unallocated" with "line was busy" — a
// busy line is alive. Scored separately so it can't deflate the headline rate.
const DEAD_WEAK = ["Couldn't Connect / Busy", "Couldn't Connect", "Could'nt connect"];

const ph = (a) => a.map(() => '?').join(',');

function buildSample(db, perGroup) {
  const deadPool = (deadSet) => db.prepare(`
    SELECT l.id, l.phone_normalized, l.business_name, l.state, l.city, l.review_count
    FROM leads l
    WHERE l.phone_normalized != '' AND l.dnc = 0
      AND EXISTS (SELECT 1 FROM notes n WHERE n.lead_id = l.id AND n.outcome IN (${ph(deadSet)}))
      AND NOT EXISTS (SELECT 1 FROM notes n2 WHERE n2.lead_id = l.id AND n2.outcome IN (${ph(PROOF_OF_LIFE)}))
    ORDER BY l.id
  `).all(...deadSet, ...PROOF_OF_LIFE);

  const humanPool = db.prepare(`
    SELECT l.id, l.phone_normalized, l.business_name, l.state, l.city, l.review_count
    FROM leads l
    WHERE l.phone_normalized != '' AND l.dnc = 0
      AND EXISTS (SELECT 1 FROM notes n WHERE n.lead_id = l.id AND n.outcome IN (${ph(HUMAN)}))
    ORDER BY l.id
  `).all(...HUMAN);

  // Deterministic even spread across each pool (id-ordered, evenly stepped) so
  // the sample is reproducible and not clustered in one import batch.
  const spread = (rows, n) => {
    if (rows.length <= n) return rows;
    const step = rows.length / n;
    return Array.from({ length: n }, (_, i) => rows[Math.floor(i * step)]);
  };

  const half = Math.round(perGroup / 2);
  return [
    ...spread(deadPool(DEAD_STRONG), half).map((r) => ({ ...r, truth: 'DEAD', truthDetail: 'bad_data' })),
    ...spread(deadPool(DEAD_WEAK), perGroup - half).map((r) => ({ ...r, truth: 'DEAD', truthDetail: 'couldnt_connect' })),
    ...spread(humanPool, perGroup).map((r) => ({ ...r, truth: 'LIVE', truthDetail: 'reached_human' })),
  ];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookupOne(client, e164, attempt = 0) {
  try {
    const r = await client.lookups.v2.phoneNumbers(e164).fetch({ fields: 'line_type_intelligence' });
    const lt = r.lineTypeIntelligence || {};
    return {
      lookup_status: 'ok',
      // NOTE: `valid` is only a numbering-plan sanity check — Twilio returns
      // valid:true for obviously fake 555 numbers. It is NOT a connectivity
      // signal. The useful "this line isn't provisioned" hint is lt.errorCode
      // (60600 = unprovisioned / out of coverage) and a null line type.
      valid: r.valid === true,
      validationErrors: r.validationErrors || [],
      line_type: lt.type ?? null,
      carrier: lt.carrierName ?? null,
      lt_error_code: lt.errorCode ?? null,
    };
  } catch (err) {
    // 20404 = the number isn't in the numbering plan at all — a genuine dead
    // number, not an outage, so it must not be lumped in with api_error.
    if (err.status === 404 || err.code === 20404) {
      return { lookup_status: 'not_found', valid: false, validationErrors: ['not_found'], line_type: null, carrier: null, lt_error_code: null };
    }
    if ((err.status === 429 || err.status >= 500) && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      return lookupOne(client, e164, attempt + 1);
    }
    return { lookup_status: 'api_error', valid: null, validationErrors: [], line_type: null, carrier: null, lt_error_code: null, error: err.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const reportOnly = args.includes('--report-only');
  const sampleSize = parseInt((args.find((a) => a.startsWith('--sample=')) || '').split('=')[1] || '200', 10);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = new Database(DB_PATH, { readonly: true });

  let sample;
  if (fs.existsSync(SAMPLE_FILE)) {
    sample = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));
    console.log(`Reusing cached sample: ${sample.length} leads`);
  } else {
    sample = buildSample(db, Math.round(sampleSize / 2));
    fs.writeFileSync(SAMPLE_FILE, JSON.stringify(sample, null, 2));
    console.log(`Built sample: ${sample.length} leads -> ${SAMPLE_FILE}`);
  }
  db.close();

  let results = fs.existsSync(RESULTS_FILE) ? JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')) : {};

  if (!reportOnly) {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const todo = sample.filter((s) => !results[s.id] || results[s.id].lookup_status === 'api_error');
    console.log(`Looking up ${todo.length} numbers (${sample.length - todo.length} cached)...\n`);

    for (let i = 0; i < todo.length; i++) {
      const lead = todo[i];
      const res = await lookupOne(client, '+1' + lead.phone_normalized);
      results[lead.id] = { ...res, checked_at: new Date().toISOString() };
      if ((i + 1) % 10 === 0 || i === todo.length - 1) {
        fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
        process.stdout.write(`\r  ${i + 1}/${todo.length} done`);
      }
      await sleep(60); // ~16/s, comfortably under Lookup's rate ceiling
    }
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    console.log('\n');
  }

  report(sample, results);
}

function report(sample, results) {
  const scored = sample.map((s) => ({ ...s, r: results[s.id] })).filter((s) => s.r);
  const errored = scored.filter((s) => s.r.lookup_status === 'api_error');
  const usable = scored.filter((s) => s.r.lookup_status !== 'api_error');

  // `valid` alone is a weak signal (Twilio returns valid:true for fake 555
  // numbers), so score several candidate rules and let the data pick the
  // definition rather than assuming one up front.
  const RULES = {
    'A: valid=false only': (s) => s.r.valid === false || s.r.lookup_status === 'not_found',
    'B: + no line type': (s) => s.r.valid === false || s.r.lookup_status === 'not_found' || s.r.line_type == null,
    'C: + LTI errorCode set': (s) => s.r.valid === false || s.r.lookup_status === 'not_found' || s.r.lt_error_code != null,
  };
  const flaggedDead = RULES['C: + LTI errorCode set'];

  const groups = {
    'DEAD (Bad Data / Wrong Number)': usable.filter((s) => s.truthDetail === 'bad_data'),
    "DEAD (Couldn't Connect / Busy)": usable.filter((s) => s.truthDetail === 'couldnt_connect'),
    'LIVE (reached a human)': usable.filter((s) => s.truthDetail === 'reached_human'),
  };

  console.log('='.repeat(78));
  console.log('BACK-TEST: does Twilio Lookup predict my observed call outcomes?');
  console.log('='.repeat(78));
  console.log(`Sample: ${scored.length} already-dialed leads | usable: ${usable.length} | API errors: ${errored.length}\n`);

  console.log('CONFUSION MATRIX');
  console.log('-'.repeat(78));
  console.log('Ground truth (my dispositions)          n    Lookup=dead   Lookup=valid    rate');
  console.log('-'.repeat(78));
  for (const [name, rows] of Object.entries(groups)) {
    if (!rows.length) continue;
    const dead = rows.filter(flaggedDead).length;
    const pctv = rows.length ? ((dead / rows.length) * 100).toFixed(1) : '0.0';
    console.log(`${name.padEnd(38)} ${String(rows.length).padStart(3)}   ${String(dead).padStart(9)}   ${String(rows.length - dead).padStart(11)}   ${(pctv + '%').padStart(6)}`);
  }
  console.log('-'.repeat(78));

  const strong = groups['DEAD (Bad Data / Wrong Number)'];
  const weak = groups["DEAD (Couldn't Connect / Busy)"];
  const live = groups['LIVE (reached a human)'];
  const catchStrong = strong.length ? (strong.filter(flaggedDead).length / strong.length) * 100 : 0;
  const catchAll = (strong.length + weak.length)
    ? ([...strong, ...weak].filter(flaggedDead).length / (strong.length + weak.length)) * 100 : 0;
  const falsePos = live.length ? (live.filter(flaggedDead).length / live.length) * 100 : 0;

  console.log('\nRULE COMPARISON — which definition of "Lookup says dead" predicts best?');
  console.log('-'.repeat(78));
  console.log('rule                       catch: BadData   catch: all dead   FALSE POS on good');
  console.log('-'.repeat(78));
  const deadAll = [...strong, ...weak];
  for (const [name, rule] of Object.entries(RULES)) {
    const c1 = strong.length ? (strong.filter(rule).length / strong.length) * 100 : 0;
    const cAll = deadAll.length ? (deadAll.filter(rule).length / deadAll.length) * 100 : 0;
    const fp = live.length ? (live.filter(rule).length / live.length) * 100 : 0;
    console.log(`${name.padEnd(26)} ${(c1.toFixed(1) + '%').padStart(13)}   ${(cAll.toFixed(1) + '%').padStart(15)}   ${(fp.toFixed(1) + '%').padStart(17)}`);
  }
  console.log('-'.repeat(78));

  console.log('\nHEADLINE NUMBERS (using rule C)');
  console.log(`  Catch rate on "Bad Data / Wrong Number":  ${catchStrong.toFixed(1)}%   (gate: >50%)`);
  console.log(`  Catch rate on all dead-ish dispositions:  ${catchAll.toFixed(1)}%`);
  console.log(`  FALSE POSITIVE rate on good leads:        ${falsePos.toFixed(1)}%   (gate: <5%)`);
  if (live.filter(flaggedDead).length) {
    console.log('\n  !! Lookup called these DEAD but I reached a human on them:');
    live.filter(flaggedDead).forEach((s) => console.log(`     #${s.id} ${s.business_name} (+1${s.phone_normalized}) status=${s.r.lookup_status}`));
  }

  console.log('\nLINE TYPE DISTRIBUTION (valid numbers only)');
  const byType = {};
  usable.filter((s) => !flaggedDead(s)).forEach((s) => {
    const k = s.r.line_type || 'null';
    byType[k] = byType[k] || { live: 0, dead: 0 };
    byType[k][s.truth === 'LIVE' ? 'live' : 'dead']++;
  });
  console.log('  line_type          reached-human   dead-disposition');
  Object.entries(byType).sort((a, b) => (b[1].live + b[1].dead) - (a[1].live + a[1].dead))
    .forEach(([k, v]) => console.log(`  ${k.padEnd(18)} ${String(v.live).padStart(13)}   ${String(v.dead).padStart(16)}`));

  if (errored.length) {
    console.log(`\n  ${errored.length} API errors (retry with a re-run): ${[...new Set(errored.map((e) => e.r.error))].slice(0, 3).join('; ')}`);
  }
  console.log(`\nLookups actually billed this session: see \`node scripts/lookup-cost.cjs\``);
}

main().catch((e) => { console.error(e); process.exit(1); });
